// src/pages/hub/api/pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { POST, GET } from './pipeline';

// No cookie / no session secret → unauthorized on both verbs (no DB needed).
const locals = {} as App.Locals;
const req = (body?: unknown, url = 'https://x/hub/api/pipeline') =>
  new Request(url, { method: body !== undefined ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });

describe('/hub/api/pipeline', () => {
  it('POST without a session → 401', async () => {
    const res = await POST({ request: req({ op: { type: 'archivePerson', id: 'p1' } }), locals } as any);
    expect(res.status).toBe(401);
  });
  it('GET without a session → 401', async () => {
    const res = await GET({ request: req(undefined), locals } as any);
    expect(res.status).toBe(401);
  });
});
