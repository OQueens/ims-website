import { describe, it, expect } from 'vitest';
import { POST, GET } from '../../pages/hub/api/sync';
import { signSession } from './session';
import { validateOp } from './sync-ops';

const SECRET = 'test-secret-0123456789-abcdef';

function locals(env: Record<string, string> = {}) {
  return { runtime: { env: { HUB_SESSION_SECRET: SECRET, HUB_SESSION_GENERATION: '1', HUB_ALLOWED_DOMAIN: 'iastaffing.com', ...env } } };
}

async function callPost(body: unknown, opts: { cookie?: string; env?: Record<string, string> } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (opts.cookie) headers.set('cookie', opts.cookie);
  const request = new Request('https://ims/hub/api/sync', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST({ request, locals: locals(opts.env) } as never);
}

async function callGet(query: string, opts: { cookie?: string; env?: Record<string, string> } = {}) {
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', opts.cookie);
  const request = new Request('https://ims/hub/api/sync' + query, { method: 'GET', headers });
  return GET({ request, locals: locals(opts.env) } as never);
}

async function validCookie() {
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession('zach@iastaffing.com', 'Zach', SECRET, now);
  return 'hub_session=' + token;
}

const emptyCol = { v: 2, sections: [] };

describe('POST /hub/api/sync', () => {
  it('401s with no session cookie', async () => {
    const res = await callPost({ weekKey: '2026-W24', columnKey: 'recruiting', column: emptyCol });
    expect(res.status).toBe(401);
  });

  it('401s with a forged/invalid session', async () => {
    const res = await callPost({ weekKey: '2026-W24', columnKey: 'recruiting', column: emptyCol }, { cookie: 'hub_session=not.valid' });
    expect(res.status).toBe(401);
  });

  it('400s on invalid JSON for an authenticated request', async () => {
    const res = await callPost('{not json', { cookie: await validCookie() });
    expect(res.status).toBe(400);
  });

  it('400s on a bad column key (unknown column)', async () => {
    const res = await callPost({ weekKey: '2026-W24', columnKey: 'finance', op: { type: 'clearColumn' } }, { cookie: await validCookie() });
    expect(res.status).toBe(400);
  });

  it('400s on a malformed op (deleteFocus missing focusId)', async () => {
    const res = await callPost(
      { weekKey: '2026-W24', columnKey: 'recruiting', op: { type: 'deleteFocus', sectionId: 'abcd' } },
      { cookie: await validCookie() },
    );
    expect(res.status).toBe(400);
  });

  it('503s when storage is unconfigured (no Supabase env) for a valid op', async () => {
    const body = { weekKey: '2026-W24', columnKey: 'recruiting', op: { type: 'clearColumn' } };
    const res = await callPost(body, { cookie: await validCookie() });
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('storage-unconfigured');
  });

  it('503s for a valid addSection op (passes op validation, fails at storage)', async () => {
    const res = await callPost(
      { weekKey: '2026-W24', columnKey: 'operations', op: { type: 'addSection', section: { id: 'sec01', title: 'Planning' } } },
      { cookie: await validCookie() },
    );
    expect(res.status).toBe(503);
  });
});

describe('validateOp — pure contract checks', () => {
  it('rejects undefined', () => {
    expect(validateOp(undefined).ok).toBe(false);
  });

  it('rejects an unknown op type', () => {
    expect(validateOp({ type: 'evil' }).ok).toBe(false);
  });

  it('rejects deleteFocus missing focusId', () => {
    const result = validateOp({ type: 'deleteFocus', sectionId: 'abcd' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad-deleteFocus');
  });

  it('accepts a valid clearColumn op', () => {
    const result = validateOp({ type: 'clearColumn' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.op.type).toBe('clearColumn');
  });
});

describe('GET /hub/api/sync', () => {
  it('401s with no session', async () => {
    const res = await callGet('?week=2026-W24');
    expect(res.status).toBe(401);
  });

  it('400s on a bad week key (authed)', async () => {
    const res = await callGet('?week=nope', { cookie: await validCookie() });
    expect(res.status).toBe(400);
  });

  it('503s for a week read when storage is unconfigured', async () => {
    const res = await callGet('?week=2026-W24', { cookie: await validCookie() });
    expect(res.status).toBe(503);
  });

  it('503s for a ?list read when storage is unconfigured', async () => {
    const res = await callGet('?list=1', { cookie: await validCookie() });
    expect(res.status).toBe(503);
  });
});
