import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase client. createClient(url, key) -> { from } where from(table)
// returns a builder. We configure the builder per-test via helpers below.
const createClientMock = vi.hoisted(() => vi.fn());
const fromMock = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

import { buildContactRow, insertContactMessage, markResendOutcome } from './contact-persistence';

const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc_role_key' };

// insert path: from(t).insert(row).select('id').single() -> { data, error }
function stubInsert(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  fromMock.mockReturnValue({ insert });
  return { insert, select, single };
}

// update path: from(t).update(patch, { count: 'exact' }).eq('id', id) -> { error, count }
function stubUpdate(result: { error: unknown; count?: number | null }) {
  const eq = vi.fn().mockResolvedValue(result);
  const update = vi.fn((_patch: unknown, _opts?: unknown) => ({ eq }));
  fromMock.mockReturnValue({ update });
  return { update, eq };
}

beforeEach(() => {
  createClientMock.mockReset();
  fromMock.mockReset();
  createClientMock.mockReturnValue({ from: fromMock });
});

describe('buildContactRow', () => {
  const meta = { ipHash: 'abc123', userAgent: 'Mozilla/5.0' };

  it('coerces empty role and message to null and carries the rest', () => {
    const row = buildContactRow(
      { name: 'Jordan', email: 'j@x.co', audience: 'facility', role: '', message: '' },
      meta,
    );
    expect(row).toEqual({
      name: 'Jordan', email: 'j@x.co', audience: 'facility',
      role: null, message: null, ip_hash: 'abc123', user_agent: 'Mozilla/5.0',
    });
  });

  it('keeps non-empty role/message and null meta', () => {
    const row = buildContactRow(
      { name: 'A', email: 'a@b.co', audience: 'clinician', role: 'CRNA', message: 'Hi there' },
      { ipHash: null, userAgent: null },
    );
    expect(row.role).toBe('CRNA');
    expect(row.message).toBe('Hi there');
    expect(row.ip_hash).toBeNull();
    expect(row.user_agent).toBeNull();
    expect(row.audience).toBe('clinician');
  });
});

describe('insertContactMessage', () => {
  const row = {
    name: 'A', email: 'a@b.co', audience: 'facility' as const,
    role: null, message: 'hi', ip_hash: null, user_agent: null,
  };

  it('does not call createClient and reports unconfigured when env is incomplete', async () => {
    const res = await insertContactMessage({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, row);
    expect(res).toEqual({ ok: false, configured: false });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('inserts into ims_contact_messages and returns the new id on success', async () => {
    const stub = stubInsert({ data: { id: 'row-uuid-1' }, error: null });
    const res = await insertContactMessage(ENV, row);
    expect(res).toEqual({ ok: true, configured: true, id: 'row-uuid-1' });
    expect(fromMock).toHaveBeenCalledWith('ims_contact_messages');
    expect(stub.insert).toHaveBeenCalledWith(row);
  });

  it('returns ok:false with the error when supabase reports one', async () => {
    stubInsert({ data: null, error: { message: 'duplicate key' } });
    const res = await insertContactMessage(ENV, row);
    expect(res.ok).toBe(false);
    expect(res.configured).toBe(true);
    expect(res.error).toContain('duplicate key');
  });

  it('truncates an oversized insert error to <=500 chars', async () => {
    stubInsert({ data: null, error: { message: 'e'.repeat(900) } });
    const res = await insertContactMessage(ENV, row);
    expect(res.ok).toBe(false);
    expect((res.error ?? '').length).toBeLessThanOrEqual(500);
  });

  it('treats a no-error/no-id response as failure (ok cannot be true without an id)', async () => {
    stubInsert({ data: null, error: null });
    const res = await insertContactMessage(ENV, row);
    expect(res.ok).toBe(false);
    expect(res.configured).toBe(true);
    expect(res.id).toBeUndefined();
  });

  it('never throws — returns ok:false when the client throws', async () => {
    createClientMock.mockImplementation(() => { throw new Error('client boom'); });
    const res = await insertContactMessage(ENV, row);
    expect(res.ok).toBe(false);
    expect(res.configured).toBe(true);
    expect(res.error).toContain('client boom');
  });
});

describe('markResendOutcome', () => {
  it('does not call createClient and reports unconfigured when env is incomplete', async () => {
    const res = await markResendOutcome({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, 'id1', true);
    expect(res).toEqual({ ok: false, configured: false });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('marks resend_status=sent and clears resend_error on success (with exact count)', async () => {
    const stub = stubUpdate({ error: null, count: 1 });
    const res = await markResendOutcome(ENV, 'row-uuid-1', true);
    expect(res.ok).toBe(true);
    expect(stub.update).toHaveBeenCalledWith({ resend_status: 'sent', resend_error: null }, { count: 'exact' });
    expect(stub.eq).toHaveBeenCalledWith('id', 'row-uuid-1');
  });

  it('marks resend_status=failed and stores a truncated error on failure', async () => {
    const stub = stubUpdate({ error: null, count: 1 });
    const longErr = 'e'.repeat(900);
    const res = await markResendOutcome(ENV, 'row-uuid-2', false, longErr);
    expect(res.ok).toBe(true);
    const patch = stub.update.mock.calls[0][0] as { resend_status: string; resend_error: string };
    expect(patch.resend_status).toBe('failed');
    expect(patch.resend_error.length).toBeLessThanOrEqual(500);
  });

  it('stores resend_error=null when a failure carries no error string', async () => {
    const stub = stubUpdate({ error: null, count: 1 });
    const res = await markResendOutcome(ENV, 'row-uuid-3', false);
    expect(res.ok).toBe(true);
    const patch = stub.update.mock.calls[0][0] as { resend_status: string; resend_error: string | null };
    expect(patch.resend_status).toBe('failed');
    expect(patch.resend_error).toBeNull();
  });

  it('returns ok:false when the update matches zero rows (id not found)', async () => {
    stubUpdate({ error: null, count: 0 });
    const res = await markResendOutcome(ENV, 'missing-id', true);
    expect(res.ok).toBe(false);
    expect(res.configured).toBe(true);
    expect(res.error ?? '').toMatch(/0 rows/i);
  });

  it('returns ok:false when the update errors', async () => {
    stubUpdate({ error: { message: 'update failed' } });
    const res = await markResendOutcome(ENV, 'id', true);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('update failed');
  });

  it('never throws — returns ok:false when the client throws', async () => {
    createClientMock.mockImplementation(() => { throw new Error('boom'); });
    const res = await markResendOutcome(ENV, 'id', true);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('boom');
  });
});
