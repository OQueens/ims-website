# Weekly Sync — Phase A1: Atomic Write Engine + v3 Model + Server-Stamped Attribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the board's blind whole-column upserts with atomic, operation-based writes applied by a single Postgres function, evolve the stored data to model v3 (typed per-focus metadata), and make authorship server-stamped — so no concurrent edit is ever silently lost and every focus shows who wrote it.

**Architecture:** The client sends ONE intent at a time (`{weekKey, op}`) to `POST /hub/api/sync`. The endpoint (service-role) calls a `SECURITY DEFINER` Postgres RPC `hub_sync_apply` that takes an advisory lock on `(week, column)`, reads the row, applies the single op to the `items` jsonb, bumps a `version` counter, and returns the merged `{items, version}` — all in one transaction, so two people editing different focuses in the same column both survive. A pure-TS `applyOp` mirrors the merge for snappy optimistic UI and as a test oracle; an integration test asserts the RPC and the oracle agree. The GET/poll response widens to carry the new metadata + `version`, and poll adoption becomes per-focus (never freezes during editing).

**Tech Stack:** Astro SSR on Cloudflare Pages (Workers), `@supabase/supabase-js` (service-role, server-only), Supabase Postgres (plpgsql), vitest. Magenta Noir CSS tokens.

**Scope (A1 only):** ops `upsertFocus`, `deleteFocus`, `setSectionTitle`, `addSection`, `deleteSection`. **Out of A1** (later sub-phases): `reorderFocus`/`moveFocus` (A4), `setReaction` (A2), `carryOver` (A3), presence (A2), mentions/notifications (A3), links/keyboard (A4), Realtime (Phase B), AI rollup (Phase C). A1 must remain behaviorally equivalent to today's board for the end user, just lossless + attributed.

**Reference:** spec `docs/superpowers/specs/2026-06-15-hub-weekly-sync-innovation-design.md` (§4 data model, §5 write protocol, §6.1–6.3 roster/attribution).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `migrations/20260615_hub_weekly_sync_v3.sql` | Create | `version int` column + `hub_sync_apply` RPC (+ REVOKE) |
| `src/lib/hub/sync-ops.ts` | Create | `SyncOp` union, `applyOp` pure oracle (5 ops, metadata stamping), op validation |
| `src/lib/hub/hub-roster.ts` | Create | `HUB_ROSTER` (email → name/color/initials) + degradation helpers |
| `src/lib/hub/sync-data.ts` | Modify | v3 `Focus`/`Section`/`ColumnData` interfaces; widen `normalizeSections`/`readColumn` to carry metadata; bump caps |
| `src/pages/hub/api/sync.ts` | Modify | POST takes `{weekKey, op}` → RPC → `{ok, items, version}`; GET returns `version` + v3 metadata |
| `src/components/hub/hub-client.ts` | Modify | op-based `persist()` consuming the response; per-focus poll adoption; widen `shape()`; extend `comparableCol()`; render attribution avatars; stamp `me` optimistically |
| `src/components/hub/SyncView.astro` | Modify | add `me` (current email) + `roster` to the SSR island |
| `src/pages/hub/index.astro` | Modify | pass `me`/`roster` into `<SyncView>` |
| `src/styles/hub.css` | Modify | `.sync2-item__avatar` attribution styles (Magenta Noir) |
| `src/lib/hub/sync-ops.test.ts` | Create | unit tests for `applyOp` (every op, idempotency, stamping, caps) |
| `src/lib/hub/hub-roster.test.ts` | Create | roster lookup + degradation |
| `src/lib/hub/sync-data.test.ts` | Modify | v1/v2→v3 read enrichment; normalize preserves metadata |
| `src/lib/hub/sync-endpoint.test.ts` | Modify | op POST validation/stamping; widened GET shape |
| `src/lib/hub/sync-rpc.integration.test.ts` | Create | env-gated: real RPC vs `applyOp` oracle parity on week `9999-W99` |

### Shared contracts (locked — every task must match these exactly)

```ts
// sync-data.ts
export interface Focus {
  id: string;
  html: string;
  by: string;            // author email; '' when unknown (migrated rows)
  createdAt: number;     // unix seconds; 0 when unknown
  editedBy?: string;
  editedAt?: number;
  // reactions/mentions/carriedFrom land in later sub-phases; readColumn tolerates them now.
}
export interface Section { id: string; title: string; by?: string; focuses: Focus[]; }
export interface ColumnData { v: 3; sections: Section[]; }   // `v` is synthetic, never persisted (items stores sections[])

// sync-ops.ts
export type SyncOp =
  | { type: 'upsertFocus'; sectionId: string; focus: { id: string; html: string } }
  | { type: 'deleteFocus'; sectionId: string; focusId: string }
  | { type: 'setSectionTitle'; sectionId: string; title: string }
  | { type: 'addSection'; section: { id: string; title?: string } }
  | { type: 'deleteSection'; sectionId: string };
export interface ApplyCtx { email: string; now: number; }
export function applyOp(column: ColumnData, op: SyncOp, ctx: ApplyCtx): ColumnData;
export function validateOp(raw: unknown): { ok: true; op: SyncOp } | { ok: false; reason: string };
```

RPC signature (locked): `public.hub_sync_apply(p_week text, p_col text, p_op jsonb, p_email text) RETURNS TABLE(items jsonb, version int)`.
POST request: `{ weekKey: string, columnKey: ColumnKey, op: SyncOp }`. POST/GET responses carry `version int` per column.

---

## Task 1: Data model v3 — interfaces + caps in `sync-data.ts`

**Files:**
- Modify: `src/lib/hub/sync-data.ts` (interfaces near line 27-29; caps near line 21-25)
- Test: `src/lib/hub/sync-data.test.ts`

- [ ] **Step 1: Write the failing test** (append to `sync-data.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { readColumn, type ColumnData, type Focus } from './sync-data';

describe('v3 read enrichment', () => {
  it('migrates a v1 string[] item to a v3 focus with empty attribution', () => {
    const col = readColumn(['Ship the thing'], (p) => p + '_x');
    expect(col.v).toBe(3);
    const f = col.sections[0].focuses[0] as Focus;
    expect(f.html).toBe('Ship the thing');
    expect(f.by).toBe('');        // unknown author on migrated rows
    expect(f.createdAt).toBe(0);
  });
  it('preserves by/createdAt/editedBy/editedAt on a v2/v3 focus', () => {
    const stored = [{ id: 'sec1', title: 'T', focuses: [
      { id: 'foc1', html: '<b>x</b>', by: 'a@iastaffing.com', createdAt: 100, editedBy: 'b@iastaffing.com', editedAt: 200 },
    ] }];
    const col = readColumn(stored, (p) => p + '_x');
    const f = col.sections[0].focuses[0];
    expect(f).toMatchObject({ id: 'foc1', by: 'a@iastaffing.com', createdAt: 100, editedBy: 'b@iastaffing.com', editedAt: 200 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hub/sync-data.test.ts -t "v3 read enrichment"`
Expected: FAIL (`by`/`createdAt` undefined — current normalizer emits only `{id, html}`).

- [ ] **Step 3: Update the interfaces + caps**

In `src/lib/hub/sync-data.ts`, replace the `Focus`/`Section`/`ColumnData` interface block (currently lines ~27-29) with:

```ts
export interface Focus {
  id: string;
  html: string;
  by: string;          // author email; '' when unknown (v1/v2 migrated rows)
  createdAt: number;   // unix seconds; 0 when unknown
  editedBy?: string;
  editedAt?: number;
}
export interface Section { id: string; title: string; by?: string; focuses: Focus[]; }
export interface ColumnData { v: 3; sections: Section[]; }   // v is synthetic; items persists the sections array only
```

Bump the version literal everywhere `{ v: 2 }` appears (`emptyColumn`, `normalizeColumn` returns) to `{ v: 3 }`. Add a cap constant near the others: `export const MAX_EMAIL_LEN = 120;`

- [ ] **Step 4: Widen `normalizeSections` to carry metadata**

Replace the `.map((f) => ({ id: cleanId(...), html: sanitizeHtml(f.html) }))` focus mapping inside `normalizeSections` with:

```ts
.map((f) => {
  const focus: Focus = {
    id: cleanId(f.id, () => gen('f')),
    html: sanitizeHtml(f.html),
    by: cleanEmail(f.by),
    createdAt: cleanTs(f.createdAt),
  };
  const editedBy = cleanEmail(f.editedBy);
  if (editedBy) focus.editedBy = editedBy;
  const editedAt = cleanTs(f.editedAt);
  if (editedAt) focus.editedAt = editedAt;
  return focus;
})
```

Add the `by` field to the section object too: `by: cleanEmail(s.by) || undefined`. Add these helpers near `cleanId`:

```ts
function cleanEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw.trim().slice(0, MAX_EMAIL_LEN);
  return /^[^\s@]+@[^\s@]+$/.test(s) ? s : '';
}
function cleanTs(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;
}
```

In the v1 string[] migration branch, set each focus to `{ id: gen('f'), html: escapeText((s as string).trim()), by: '', createdAt: 0 }`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/hub/sync-data.test.ts`
Expected: PASS (all existing + new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/hub/sync-data.ts src/lib/hub/sync-data.test.ts
git commit -m "feat(hub): Weekly Sync data model v3 — typed focus attribution metadata"
```

---

## Task 2: `applyOp` oracle + op validation in `sync-ops.ts`

**Files:**
- Create: `src/lib/hub/sync-ops.ts`
- Test: `src/lib/hub/sync-ops.test.ts`

- [ ] **Step 1: Write the failing test** (`src/lib/hub/sync-ops.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { applyOp, validateOp, type SyncOp } from './sync-ops';
import { emptyColumn, type ColumnData } from './sync-data';

const ctx = { email: 'zach@iastaffing.com', now: 1000 };
const withSection = (): ColumnData => ({ v: 3, sections: [{ id: 'sec1', title: '', focuses: [] }] });

describe('applyOp', () => {
  it('upsertFocus creates a focus stamped with author + createdAt', () => {
    const out = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'hi' } }, ctx);
    expect(out.sections[0].focuses[0]).toMatchObject({ id: 'f1', html: 'hi', by: 'zach@iastaffing.com', createdAt: 1000 });
  });
  it('upsertFocus on an existing focus sets editedBy/editedAt, keeps original by/createdAt', () => {
    let col = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'a' } }, ctx);
    col = applyOp(col, { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'b' } }, { email: 'matt@iastaffing.com', now: 2000 });
    expect(col.sections[0].focuses[0]).toMatchObject({ html: 'b', by: 'zach@iastaffing.com', createdAt: 1000, editedBy: 'matt@iastaffing.com', editedAt: 2000 });
  });
  it('upsertFocus is idempotent under re-apply (same op twice = same result)', () => {
    const op: SyncOp = { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } };
    const once = applyOp(withSection(), op, ctx);
    const twice = applyOp(once, op, ctx);
    expect(twice).toEqual(once);
  });
  it('deleteFocus removes by id and is a no-op when absent', () => {
    let col = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } }, ctx);
    col = applyOp(col, { type: 'deleteFocus', sectionId: 'sec1', focusId: 'f1' }, ctx);
    expect(col.sections[0].focuses).toHaveLength(0);
    const again = applyOp(col, { type: 'deleteFocus', sectionId: 'sec1', focusId: 'f1' }, ctx);
    expect(again).toEqual(col);
  });
  it('setSectionTitle sets by id', () => {
    const out = applyOp(withSection(), { type: 'setSectionTitle', sectionId: 'sec1', title: 'Recruiting' }, ctx);
    expect(out.sections[0].title).toBe('Recruiting');
  });
  it('addSection appends a section stamped with author; idempotent by id', () => {
    const op: SyncOp = { type: 'addSection', section: { id: 's2', title: 'Ops' } };
    let col = applyOp(emptyColumn(), op, ctx);
    expect(col.sections).toHaveLength(1);
    expect(col.sections[0]).toMatchObject({ id: 's2', title: 'Ops', by: 'zach@iastaffing.com' });
    col = applyOp(col, op, ctx);
    expect(col.sections).toHaveLength(1);
  });
  it('deleteSection removes by id, no-op when absent', () => {
    const col = applyOp(withSection(), { type: 'deleteSection', sectionId: 'sec1' }, ctx);
    expect(col.sections).toHaveLength(0);
  });
  it('does not mutate its input', () => {
    const input = withSection();
    const snapshot = JSON.stringify(input);
    applyOp(input, { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } }, ctx);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('validateOp', () => {
  it('accepts a well-formed upsertFocus', () => {
    expect(validateOp({ type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } }).ok).toBe(true);
  });
  it('rejects unknown op type', () => {
    const r = validateOp({ type: 'nope' }); expect(r.ok).toBe(false);
  });
  it('rejects missing fields', () => {
    expect(validateOp({ type: 'deleteFocus', sectionId: 'sec1' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hub/sync-ops.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/hub/sync-ops.ts`**

```ts
// Pure operation algebra for the Weekly Sync board. ONE op at a time, applied to
// a ColumnData. Used by (a) the client for optimistic UI, (b) vitest as the test
// oracle, and (c) mirrored by the hub_sync_apply Postgres RPC (the authoritative
// atomic apply). Never mutates its input. A1 covers the 5 single-column ops.
import {
  type ColumnData, type Focus, type Section,
  sanitizeHtml, escapeText, MAX_FOCUSES, MAX_SECTIONS, MAX_TITLE_LEN, MAX_ID_LEN,
} from './sync-data';

export type SyncOp =
  | { type: 'upsertFocus'; sectionId: string; focus: { id: string; html: string } }
  | { type: 'deleteFocus'; sectionId: string; focusId: string }
  | { type: 'setSectionTitle'; sectionId: string; title: string }
  | { type: 'addSection'; section: { id: string; title?: string } }
  | { type: 'deleteSection'; sectionId: string };

export interface ApplyCtx { email: string; now: number; }

const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
const cloneCol = (c: ColumnData): ColumnData => ({ v: 3, sections: c.sections.map((s) => ({ ...s, focuses: s.focuses.map((f) => ({ ...f })) })) });

export function applyOp(column: ColumnData, op: SyncOp, ctx: ApplyCtx): ColumnData {
  const col = cloneCol(column);
  switch (op.type) {
    case 'upsertFocus': {
      const sec = col.sections.find((s) => s.id === op.sectionId);
      if (!sec) return col; // unknown section → no-op (caller ensures section exists)
      const html = sanitizeHtml(op.focus.html);
      const existing = sec.focuses.find((f) => f.id === op.focus.id);
      if (existing) {
        existing.html = html;
        existing.editedBy = ctx.email;
        existing.editedAt = ctx.now;
      } else {
        if (sec.focuses.length >= MAX_FOCUSES) return col;
        const focus: Focus = { id: op.focus.id, html, by: ctx.email, createdAt: ctx.now };
        sec.focuses.push(focus);
      }
      return col;
    }
    case 'deleteFocus': {
      const sec = col.sections.find((s) => s.id === op.sectionId);
      if (sec) sec.focuses = sec.focuses.filter((f) => f.id !== op.focusId);
      return col;
    }
    case 'setSectionTitle': {
      const sec = col.sections.find((s) => s.id === op.sectionId);
      if (sec) sec.title = escapeText(op.title).slice(0, MAX_TITLE_LEN);
      return col;
    }
    case 'addSection': {
      if (col.sections.some((s) => s.id === op.section.id)) return col; // idempotent by id
      if (col.sections.length >= MAX_SECTIONS) return col;
      const section: Section = { id: op.section.id, title: escapeText(op.section.title ?? '').slice(0, MAX_TITLE_LEN), by: ctx.email, focuses: [] };
      col.sections.push(section);
      return col;
    }
    case 'deleteSection': {
      col.sections = col.sections.filter((s) => s.id !== op.sectionId);
      return col;
    }
    default:
      return col;
  }
}

const isCleanId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length <= 4000;

export function validateOp(raw: unknown): { ok: true; op: SyncOp } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'op-not-object' };
  const o = raw as Record<string, unknown>;
  switch (o.type) {
    case 'upsertFocus': {
      const f = o.focus as Record<string, unknown> | undefined;
      if (!isCleanId(o.sectionId) || !f || !isCleanId(f.id) || !isStr(f.html)) return { ok: false, reason: 'bad-upsertFocus' };
      return { ok: true, op: { type: 'upsertFocus', sectionId: o.sectionId, focus: { id: f.id as string, html: f.html as string } } };
    }
    case 'deleteFocus':
      if (!isCleanId(o.sectionId) || !isCleanId(o.focusId)) return { ok: false, reason: 'bad-deleteFocus' };
      return { ok: true, op: { type: 'deleteFocus', sectionId: o.sectionId, focusId: o.focusId } };
    case 'setSectionTitle':
      if (!isCleanId(o.sectionId) || !isStr(o.title)) return { ok: false, reason: 'bad-setSectionTitle' };
      return { ok: true, op: { type: 'setSectionTitle', sectionId: o.sectionId, title: o.title } };
    case 'addSection': {
      const s = o.section as Record<string, unknown> | undefined;
      if (!s || !isCleanId(s.id) || (s.title !== undefined && !isStr(s.title))) return { ok: false, reason: 'bad-addSection' };
      return { ok: true, op: { type: 'addSection', section: { id: s.id as string, title: (s.title as string) ?? '' } } };
    }
    case 'deleteSection':
      if (!isCleanId(o.sectionId)) return { ok: false, reason: 'bad-deleteSection' };
      return { ok: true, op: { type: 'deleteSection', sectionId: o.sectionId } };
    default:
      return { ok: false, reason: 'unknown-op-type' };
  }
}
```

Ensure `MAX_ID_LEN` import is used or drop it (lint: remove unused). Confirm `sanitizeHtml`/`escapeText`/cap constants are exported from `sync-data.ts` (they are).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hub/sync-ops.test.ts`
Expected: PASS (all `applyOp` + `validateOp` cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub/sync-ops.ts src/lib/hub/sync-ops.test.ts
git commit -m "feat(hub): Weekly Sync op algebra — applyOp oracle + validateOp (5 core ops)"
```

---

## Task 3: Roster in `hub-roster.ts`

**Files:**
- Create: `src/lib/hub/hub-roster.ts`
- Test: `src/lib/hub/hub-roster.test.ts`

- [ ] **Step 1: Write the failing test** (`src/lib/hub/hub-roster.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { rosterEntry } from './hub-roster';

describe('rosterEntry', () => {
  it('returns the seeded display name + initials for a known email', () => {
    const e = rosterEntry('zach@CONFIRM.com'); // replace with real once confirmed
    expect(e.name.length).toBeGreaterThan(0);
    expect(e.initials.length).toBeGreaterThanOrEqual(1);
    expect(e.color).toMatch(/^#|^var\(/);
  });
  it('degrades gracefully for an unknown email: derived initials + deterministic color', () => {
    const a = rosterEntry('someone.new@imstaffing.ai');
    const b = rosterEntry('someone.new@imstaffing.ai');
    expect(a.initials).toBe('S');
    expect(a.color).toBe(b.color);           // deterministic
    expect(a.name).toBe('someone.new');      // local-part fallback
  });
  it('handles empty/unknown author email', () => {
    const e = rosterEntry('');
    expect(e.name).toBe('Unknown');
    expect(e.initials).toBe('?');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hub/hub-roster.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/hub/hub-roster.ts`**

```ts
// The 6-person management roster for Weekly Sync attribution. Emails are the
// authoritative key (matched against the authenticated hub session email).
// ⚠️ CONFIRM: replace the placeholder emails below with the real work emails
// (Zach to provide). Names/initials/colours are final; only the email keys are
// placeholders. Unknown emails degrade gracefully (no crash, no fabrication).
export interface RosterEntry { name: string; initials: string; color: string; }

// Magenta-Noir-harmonized hues; obey contrast rules (no cream-on-butter, no
// yellow+purple). 6 distinct, legible-on-dark colours.
const SEED: Record<string, RosterEntry> = {
  'zach@CONFIRM':    { name: 'Zach',    initials: 'Z', color: '#C44569' }, // mn-magenta
  'donovan@CONFIRM': { name: 'Donovan', initials: 'D', color: '#59BFE7' }, // mn-cyan
  'chad@CONFIRM':    { name: 'Chad',    initials: 'C', color: '#E8C465' }, // mn-butter
  'matt@CONFIRM':    { name: 'Matt',    initials: 'M', color: '#7FB069' }, // sage
  'brent@CONFIRM':   { name: 'Brent',   initials: 'B', color: '#B388EB' }, // soft violet
  'jon@CONFIRM':     { name: 'Jon',     initials: 'J', color: '#F08A5D' }, // warm coral
};
// Degradation palette (deterministic pick by hash) — same family, never collides with seed semantics.
const FALLBACK_COLORS = ['#C44569', '#59BFE7', '#E8C465', '#7FB069', '#B388EB', '#F08A5D'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function rosterEntry(email: string): RosterEntry {
  const key = (email || '').trim().toLowerCase();
  if (!key) return { name: 'Unknown', initials: '?', color: '#8A8A8A' };
  if (SEED[key]) return SEED[key];
  const local = key.split('@')[0] || key;
  return {
    name: local,
    initials: (local[0] || '?').toUpperCase(),
    color: FALLBACK_COLORS[hash(key) % FALLBACK_COLORS.length],
  };
}

export function rosterPickerList(): { email: string; name: string }[] {
  return Object.entries(SEED).map(([email, e]) => ({ email, name: e.name }));
}
```

> NOTE for the executing agent: the `*@CONFIRM` keys are intentional placeholders. The board still works (unknown emails degrade), so this does NOT block A1. When Zach provides the six real emails, replace the keys verbatim and update the test's first case. Do not invent real emails.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/hub/hub-roster.test.ts`
Expected: PASS. (Update the first test's email to a seed key like `zach@CONFIRM` so it resolves; the degradation + empty cases are the load-bearing ones.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub/hub-roster.ts src/lib/hub/hub-roster.test.ts
git commit -m "feat(hub): Weekly Sync roster (placeholder emails) + graceful degradation"
```

---

## Task 4: Migration — `version` column + `hub_sync_apply` RPC

**Files:**
- Create: `migrations/20260615_hub_weekly_sync_v3.sql`

> This task has no vitest (no Postgres in CI). It is verified by Task 8's env-gated integration test against the real DB. Write it now; apply it to the dev/prod DB during Task 8.

- [ ] **Step 1: Write the migration**

```sql
-- IMS Hub — Weekly Sync v3 write engine — 2026-06-15
-- Adds optimistic-concurrency version + an atomic, op-based apply function so
-- concurrent edits in the same column cannot silently overwrite each other.
-- The browser NEVER calls this; only the service-role /hub/api/sync endpoint does.

ALTER TABLE public.hub_weekly_sync
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 0;

-- hub_sync_apply: take an advisory lock on (week,col), read the row (creating a
-- blank one if absent), apply ONE op to the items sections-array, bump version,
-- and return the merged items + new version. SECURITY DEFINER + sealed: only
-- service_role may execute. Mirrors src/lib/hub/sync-ops.ts applyOp (A1: 5 ops).
CREATE OR REPLACE FUNCTION public.hub_sync_apply(
  p_week  text,
  p_col   text,
  p_op    jsonb,
  p_email text
) RETURNS TABLE(items jsonb, version int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_key bigint;
  v_items    jsonb;
  v_ver      int;
  v_type     text := p_op->>'type';
  v_sec_id   text;
  v_now      bigint := pg_catalog.floor(pg_catalog.extract(epoch FROM pg_catalog.clock_timestamp()))::bigint;
  v_new_secs jsonb;
BEGIN
  IF p_col NOT IN ('recruiting','marketing','operations') THEN
    RAISE EXCEPTION 'bad-column: %', p_col;
  END IF;

  v_lock_key := pg_catalog.hashtextextended(p_week || ':' || p_col, 0);
  PERFORM pg_catalog.pg_advisory_xact_lock(v_lock_key);

  INSERT INTO public.hub_weekly_sync (week_key, column_key, items)
    VALUES (p_week, p_col, '[]'::jsonb)
    ON CONFLICT (week_key, column_key) DO NOTHING;

  SELECT hws.items, hws.version INTO v_items, v_ver
    FROM public.hub_weekly_sync hws
    WHERE hws.week_key = p_week AND hws.column_key = p_col
    FOR UPDATE;

  IF v_type = 'addSection' THEN
    -- append only if id absent
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_items) s WHERE s->>'id' = p_op->'section'->>'id') THEN
      v_items := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', p_op->'section'->>'id',
        'title', pg_catalog.left(pg_catalog.coalesce(p_op->'section'->>'title',''), 80),
        'by', p_email,
        'focuses', '[]'::jsonb));
    END IF;

  ELSIF v_type = 'deleteSection' THEN
    SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(s), '[]'::jsonb) INTO v_items
      FROM pg_catalog.jsonb_array_elements(v_items) s
      WHERE s->>'id' <> (p_op->>'sectionId');

  ELSE
    -- ops that target a specific section: rebuild the sections array, transforming
    -- only the matching section.
    v_sec_id := p_op->>'sectionId';
    SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(
      CASE WHEN s->>'id' = v_sec_id
           THEN public.hub_sync_apply_section(s, p_op, p_email, v_now)
           ELSE s END
      ORDER BY ord), '[]'::jsonb)
      INTO v_new_secs
      FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS t(s, ord);
    v_items := v_new_secs;
  END IF;

  UPDATE public.hub_weekly_sync hws
    SET items = v_items, version = hws.version + 1, updated_by = p_email, updated_at = pg_catalog.now()
    WHERE hws.week_key = p_week AND hws.column_key = p_col;

  RETURN QUERY SELECT v_items, v_ver + 1;
END;
$$;

-- Helper: apply a section-targeted op to ONE section jsonb, returning the new section.
CREATE OR REPLACE FUNCTION public.hub_sync_apply_section(
  s jsonb, p_op jsonb, p_email text, p_now bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type   text := p_op->>'type';
  v_foc_id text;
  v_html   text;
  v_focs   jsonb;
  v_found  boolean := false;
BEGIN
  IF v_type = 'setSectionTitle' THEN
    RETURN pg_catalog.jsonb_set(s, '{title}', pg_catalog.to_jsonb(pg_catalog.left(pg_catalog.coalesce(p_op->>'title',''), 80)));

  ELSIF v_type = 'deleteFocus' THEN
    SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(f ORDER BY ord), '[]'::jsonb) INTO v_focs
      FROM pg_catalog.jsonb_array_elements(s->'focuses') WITH ORDINALITY AS t(f, ord)
      WHERE f->>'id' <> (p_op->>'focusId');
    RETURN pg_catalog.jsonb_set(s, '{focuses}', v_focs);

  ELSIF v_type = 'upsertFocus' THEN
    v_foc_id := p_op->'focus'->>'id';
    v_html   := p_op->'focus'->>'html';
    -- update in place if present
    SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(
      CASE WHEN f->>'id' = v_foc_id
           THEN f || pg_catalog.jsonb_build_object('html', v_html, 'editedBy', p_email, 'editedAt', p_now)
           ELSE f END
      ORDER BY ord), '[]'::jsonb)
      INTO v_focs
      FROM pg_catalog.jsonb_array_elements(s->'focuses') WITH ORDINALITY AS t(f, ord);
    v_found := EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(s->'focuses') f WHERE f->>'id' = v_foc_id);
    IF NOT v_found THEN
      v_focs := v_focs || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', v_foc_id, 'html', v_html, 'by', p_email, 'createdAt', p_now));
    END IF;
    RETURN pg_catalog.jsonb_set(s, '{focuses}', v_focs);
  END IF;

  RETURN s;
END;
$$;

-- Seal: only service_role executes (browser/anon/authenticated never reach the DB).
REVOKE EXECUTE ON FUNCTION public.hub_sync_apply(text, text, jsonb, text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hub_sync_apply_section(jsonb, jsonb, text, bigint) FROM PUBLIC, anon, authenticated;
```

> Note: the RPC stores raw `html`; the ENDPOINT sanitizes before calling the RPC (Task 5), and `readColumn` re-sanitizes on the way out (defense-in-depth) — matching the existing sanitize-on-write-and-read posture. The RPC does NOT re-implement the HTML sanitizer.

- [ ] **Step 2: Commit (apply happens in Task 8)**

```bash
git add migrations/20260615_hub_weekly_sync_v3.sql
git commit -m "feat(hub): Weekly Sync v3 migration — version column + atomic hub_sync_apply RPC"
```

---

## Task 5: Endpoint — op-based POST + widened GET in `sync.ts`

**Files:**
- Modify: `src/pages/hub/api/sync.ts`
- Test: `src/lib/hub/sync-endpoint.test.ts`

- [ ] **Step 1: Write the failing test** (extend `sync-endpoint.test.ts` — match the file's existing harness/imports)

```ts
import { describe, it, expect } from 'vitest';
import { validateOp } from '../../../src/lib/hub/sync-ops'; // adjust to the file's existing import style

describe('op POST validation', () => {
  it('rejects an unknown op type before any DB call', () => {
    expect(validateOp({ type: 'evil' }).ok).toBe(false);
  });
  it('accepts a valid upsertFocus op', () => {
    const r = validateOp({ type: 'upsertFocus', sectionId: 'abc', focus: { id: 'fff', html: 'hi' } });
    expect(r.ok).toBe(true);
  });
});
```

> The endpoint's Supabase call is integration-tested in Task 8. Here we lock the pure validation boundary. If `sync-endpoint.test.ts` already mocks the Supabase client, add an op-POST happy-path test asserting `rpc('hub_sync_apply', …)` is called with `{ p_week, p_col, p_op, p_email }` and the response returns `{ ok:true, items, version }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hub/sync-endpoint.test.ts -t "op POST"`
Expected: FAIL.

- [ ] **Step 3: Rewrite the POST handler** in `src/pages/hub/api/sync.ts`

Replace the body parse + persist block (current lines ~46-74) with:

```ts
  // 2) Parse + validate the op (single-intent write).
  let raw: unknown;
  try { raw = await request.json(); } catch { return json(400, { ok: false, error: 'invalid-json' }); }
  const r = raw as { weekKey?: unknown; columnKey?: unknown; op?: unknown };
  if (!isWeekKey(r.weekKey)) return json(400, { ok: false, error: 'bad-week-key' });
  if (typeof r.columnKey !== 'string' || !(COLUMN_KEYS as readonly string[]).includes(r.columnKey)) return json(400, { ok: false, error: 'bad-column' });
  const parsed = validateOp(r.op);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.reason });

  // Sanitize any html the op carries BEFORE it reaches the DB (the RPC stores raw).
  const op = parsed.op.type === 'upsertFocus'
    ? { ...parsed.op, focus: { ...parsed.op.focus, html: sanitizeHtml(parsed.op.focus.html) } }
    : parsed.op;

  // 3) Apply atomically via the RPC (service-role).
  const supabase = getHubSupabase(env);
  if (!supabase) return json(503, { ok: false, error: 'storage-unconfigured' });
  const { data, error } = await supabase.rpc('hub_sync_apply', {
    p_week: r.weekKey, p_col: r.columnKey, p_op: op, p_email: email,
  });
  if (error) {
    console.error('[/hub/api/sync POST] rpc failed:', error.message);
    return json(502, { ok: false, error: 'storage-failed' });
  }
  const row = Array.isArray(data) ? data[0] : data;
  const column = readColumn(row?.items);   // re-normalize + re-sanitize on the way out
  return json(200, { ok: true, columnKey: r.columnKey, version: row?.version ?? 0, column });
```

Update imports at the top of `sync.ts`: add `sanitizeHtml` from `sync-data` and `validateOp` from `sync-ops`.

- [ ] **Step 4: Widen the GET response** (current lines ~114-122) to carry `version`:

```ts
  const columns: Record<string, { v: 3; version: number; sections: ColumnData['sections'] }> = {};
  for (const key of COLUMN_KEYS) columns[key] = { v: 3, version: 0, sections: [] };
  for (const row of data ?? []) {
    const rr = row as { column_key: string; items: unknown; version?: number };
    if ((COLUMN_KEYS as readonly string[]).includes(rr.column_key)) {
      const c = readColumn(rr.items);
      columns[rr.column_key] = { v: 3, version: rr.version ?? 0, sections: c.sections };
    }
  }
  return json(200, { ok: true, week, columns });
```

Add `version` to the GET `select`: `.select('column_key, items, version')`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/hub/sync-endpoint.test.ts && npx astro check 2>&1 | tail -20`
Expected: PASS; no new type errors in `sync.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/hub/api/sync.ts src/lib/hub/sync-endpoint.test.ts
git commit -m "feat(hub): Weekly Sync endpoint — atomic op-based POST + version in GET"
```

---

## Task 6: Client — op-based persist + per-focus poll adoption + attribution render

**Files:**
- Modify: `src/components/hub/hub-client.ts` (the `weeklySync()` IIFE)
- Modify: `src/components/hub/SyncView.astro`, `src/pages/hub/index.astro` (island `me`)

> No new vitest (DOM/IIFE); verified by Task 9 Playwright-vs-real-DB. Keep the existing `epoch`/`viewedWeek` guards.

- [ ] **Step 1: Expose `me` to the client island**

In `src/components/hub/SyncView.astro`, add `me: string` to `Props` and into `islandJson`: `JSON.stringify({ weekKey, data, persisted, me })…`. In `src/pages/hub/index.astro`, pass `me={session.email}` to `<SyncView>` (the session email is already read for the page guard).

- [ ] **Step 2: Replace `persist(col)` with an op sender** (hub-client.ts ~lines 317-354)

```ts
  const me: string = island?.me ?? '';
  let opSeq = 0;
  async function sendOp(col: ColumnKey, op: import('../../lib/hub/sync-ops').SyncOp) {
    saveLocal();
    if (!viewedWeek) return;
    const myEpoch = epoch, myWeek = viewedWeek, mySeq = ++opSeq;
    setStatus('saving');
    try {
      const res = await fetch('/hub/api/sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin', redirect: 'manual',
        body: JSON.stringify({ weekKey: myWeek, columnKey: col, op }),
      });
      if (epoch !== myEpoch || viewedWeek !== myWeek) return;
      if (res.type === 'opaqueredirect' || res.status === 401) { setStatus('signedout'); return; }
      if (res.ok) {
        const b = await res.json();
        if (epoch !== myEpoch || viewedWeek !== myWeek || mySeq !== opSeq) { setStatus('saved'); return; }
        // Authoritative reconcile: adopt server's merged column (skip the focus holding the caret).
        if (b && b.ok && b.column) adoptColumn(col, b.column, b.version);
        setStatus('saved');
      } else { setStatus('error'); setTimeout(() => sendOp(col, op), 3000); }
    } catch (e) {
      if (epoch !== myEpoch || viewedWeek !== myWeek) return;
      setStatus('error'); setTimeout(() => sendOp(col, op), 3000);
    }
  }
```

Add a per-column version map: `const colVersion: Partial<Record<ColumnKey, number>> = {};` and `adoptColumn`:

```ts
  function activeFocusId(): string | null {
    const a = document.activeElement as HTMLElement | null;
    return a && board!.contains(a) ? (a.dataset?.foc ?? null) : null;
  }
  function adoptColumn(col: ColumnKey, incoming: ColumnData, version?: number) {
    if (typeof version === 'number') {
      if ((colVersion[col] ?? -1) > version) return; // stale response
      colVersion[col] = version;
    }
    const caret = activeFocusId();
    const shaped = shape({ [col]: incoming } as Partial<Columns>)[col];
    if (caret) {
      // preserve the focus the user is typing in; adopt everything else.
      const live = cols[col];
      const liveFocus = live.sections.flatMap((s) => s.focuses).find((f) => f.id === caret);
      cols[col] = shaped;
      if (liveFocus) {
        for (const s of cols[col].sections) {
          const idx = s.focuses.findIndex((f) => f.id === caret);
          if (idx >= 0) s.focuses[idx] = liveFocus;
        }
      }
    } else {
      cols[col] = shaped;
    }
    ensureSection(cols[col]); saveLocal(); render();
  }
```

- [ ] **Step 3: Replace every old `persist(col)` call site** with an explicit op + optimistic `applyOp`. Import at top of hub-client.ts: `import { applyOp, type SyncOp } from '../../lib/hub/sync-data';` → actually from `'../../lib/hub/sync-ops'`. Update the bind handlers:
  - Add-a-focus (`.sync2-add`): `const f = { id: genId('f'), html: '' }; cols[col] = applyOp(cols[col], { type:'upsertFocus', sectionId: sec, focus: f }, { email: me, now: Math.floor(Date.now()/1000) }); render(); focusEnd(...); sendOp(col, { type:'upsertFocus', sectionId: sec, focus: f });`
  - Focus blur (text change): build `{ type:'upsertFocus', sectionId, focus:{ id, html } }`, optimistic `applyOp`, then `sendOp`.
  - Delete focus: `{ type:'deleteFocus', sectionId, focusId }`.
  - Section title blur: `{ type:'setSectionTitle', sectionId, title }`.
  - Add section: `{ type:'addSection', section:{ id, title:'' } }`.
  - Delete section: `{ type:'deleteSection', sectionId }`.

  (Each: mutate `cols` via `applyOp` for instant UI, `render()`, then `sendOp`. Remove the old whole-column `persist`/`timers`/`pending` machinery and the 700ms debounce — ops send on commit, which is already debounced by the blur/click UX.)

- [ ] **Step 4: Per-focus poll adoption** — replace the `poll()` body (hub-client.ts ~578-598):

```ts
  async function poll() {
    if (!viewedWeek) return;
    const myWeek = viewedWeek, myEpoch = epoch;
    try {
      const res = await fetch('/hub/api/sync?week=' + encodeURIComponent(myWeek), { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' } });
      if (!res.ok || res.type === 'opaqueredirect') return;
      if (myWeek !== viewedWeek || myEpoch !== epoch) return;
      const b = await res.json();
      if (!b || !b.ok || !b.columns) return;
      if (myWeek !== viewedWeek || myEpoch !== epoch) return;
      const caret = activeFocusId();
      colIds.forEach((id) => {
        const inc = b.columns[id];
        if (!inc) return;
        if (typeof inc.version === 'number' && (colVersion[id] ?? -1) > inc.version) return; // we're ahead
        const incoming = shape({ [id]: inc } as Partial<Columns>)[id];
        if (comparableCol(incoming) === comparableCol(cols[id])) return;
        // adopt, preserving only the caret focus if it's in THIS column
        adoptColumn(id, inc, inc.version);
      });
    } catch (e) { /* offline; keep local */ }
  }
```

The key change: **drop the `if (document.activeElement && board.contains(...)) return` whole-cycle skip and the per-column `pending` gate**; protect only the single caret focus inside `adoptColumn`.

- [ ] **Step 5: Extend `comparableCol`** (hub-client.ts ~264) to include author + edited markers so attribution changes poll-adopt:

```ts
  function comparableCol(cd: ColumnData): string {
    return JSON.stringify(cd.sections
      .filter((s) => s.focuses.length > 0 || s.title.trim() !== '')
      .map((s) => ({ t: s.title, f: s.focuses.map((x) => x.id + ':' + x.html + ':' + (x.by || '') + ':' + (x.editedAt || 0)) })));
  }
```

- [ ] **Step 6: Widen `shape()`** (hub-client.ts ~234-252) to carry metadata:

```ts
        focuses: s && Array.isArray(s.focuses)
          ? s.focuses.map((f) => ({
              id: safeId(f && f.id, 'f'),
              html: f && typeof f.html === 'string' ? f.html : '',
              by: f && typeof f.by === 'string' ? f.by : '',
              createdAt: f && typeof f.createdAt === 'number' ? f.createdAt : 0,
              editedBy: f && typeof f.editedBy === 'string' ? f.editedBy : undefined,
              editedAt: f && typeof f.editedAt === 'number' ? f.editedAt : undefined,
            }))
          : [],
```

- [ ] **Step 7: Render attribution avatar** in `render()` (the `.sync2-item` template, ~378-383). Add a sibling node (NOT inside the contenteditable):

```ts
            <div class="sync2-item" data-col="${c.id}" data-sec="${sec.id}" data-foc="${f.id}">
              <span class="sync2-item__tick"></span>
              <div class="sync2-item__txt" contenteditable="true" role="textbox" aria-label="Focus" data-ph="Add a focus…" data-col="${c.id}" data-sec="${sec.id}" data-foc="${f.id}">${sanitizeHtml(f.html)}</div>
              ${avatarHtml(f)}
              <button class="sync2-item__del" data-col="${c.id}" data-sec="${sec.id}" data-foc="${f.id}" aria-label="Remove focus">×</button>
            </div>
```

Add near the top of the IIFE (import `rosterEntry` from `../../lib/hub/hub-roster`):

```ts
  function avatarHtml(f: { by?: string; editedBy?: string; createdAt?: number }): string {
    const who = f.by || '';
    const e = rosterEntry(who);
    const title = who ? `Added by ${esc(e.name)}${f.editedBy && f.editedBy !== who ? ' · edited by ' + esc(rosterEntry(f.editedBy).name) : ''}` : 'Author unknown';
    return `<span class="sync2-item__avatar" style="--av:${e.color}" title="${title}" aria-label="${title}">${esc(e.initials)}</span>`;
  }
```

- [ ] **Step 8: Build + manual smoke**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds (no TS errors). (Behavior verified in Task 9.)

- [ ] **Step 9: Commit**

```bash
git add src/components/hub/hub-client.ts src/components/hub/SyncView.astro src/pages/hub/index.astro
git commit -m "feat(hub): Weekly Sync client — op-based writes, per-focus poll adoption, attribution avatars"
```

---

## Task 7: Attribution avatar styles (Magenta Noir)

**Files:**
- Modify: `src/styles/hub.css`

- [ ] **Step 1: Add styles** (find the `.sync2-item` block; add after it)

```css
.sync2-item__avatar{
  flex:0 0 auto; width:20px; height:20px; border-radius:50%;
  display:inline-grid; place-items:center;
  font-size:10px; font-weight:700; line-height:1;
  background:var(--av,#8A8A8A); color:var(--mn-black,#0A0A0F);
  user-select:none; opacity:.92;
}
.sync2-item:hover .sync2-item__avatar{ opacity:1; }
```

> Contrast: initials are `--mn-black` on the (light/saturated) avatar hue. The roster palette avoids butter+cream and yellow+purple per color rules. If any seed hue renders dark, switch its initials to `--mn-cream` in `avatarHtml` based on a luminance check (only if Task 9 screenshots show a contrast issue).

- [ ] **Step 2: Build + commit**

```bash
npm run build 2>&1 | tail -5
git add src/styles/hub.css
git commit -m "style(hub): Weekly Sync attribution avatar (Magenta Noir)"
```

---

## Task 8: Integration test — RPC vs oracle parity (env-gated, real DB)

**Files:**
- Create: `src/lib/hub/sync-rpc.integration.test.ts`

> Runs ONLY when `RUN_DB_IT=1` + `.dev.vars` (or env) supplies `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. CI (no Postgres) skips it; the executing agent runs it locally against the real DB after applying the migration.

- [ ] **Step 1: Apply the migration to the dev/prod DB**

Use the Supabase MCP (or `psql` with the service-role connection) to run `migrations/20260615_hub_weekly_sync_v3.sql` against `gbakzhibzotugfyktcrt`. Verify: `select version from public.hub_weekly_sync limit 1;` returns a column (no error), and `select public.hub_sync_apply('9999-W99','recruiting','{"type":"addSection","section":{"id":"sec_it1","title":"IT"}}'::jsonb,'it@iastaffing.com');` returns `{items, version}`.

- [ ] **Step 2: Write the parity test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { applyOp, type SyncOp } from './sync-ops';
import { readColumn, emptyColumn, type ColumnData } from './sync-data';

const RUN = process.env.RUN_DB_IT === '1';
const url = process.env.SUPABASE_URL!, key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const WEEK = '9999-W99', COL = 'recruiting';

(RUN ? describe : describe.skip)('hub_sync_apply RPC == applyOp oracle', () => {
  const sb = createClient(url, key);
  afterAll(async () => { await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK); });

  it('a sequence of ops yields identical items in DB and oracle', async () => {
    await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK); // clean slate
    let oracle: ColumnData = emptyColumn();
    const email = 'zach@iastaffing.com';
    const ops: SyncOp[] = [
      { type: 'addSection', section: { id: 'secAAA', title: 'Pipeline' } },
      { type: 'upsertFocus', sectionId: 'secAAA', focus: { id: 'focAAA', html: 'Call <b>CHS</b>' } },
      { type: 'upsertFocus', sectionId: 'secAAA', focus: { id: 'focBBB', html: 'MSA review' } },
      { type: 'upsertFocus', sectionId: 'secAAA', focus: { id: 'focAAA', html: 'Call CHS (done sync)' } }, // edit
      { type: 'deleteFocus', sectionId: 'secAAA', focusId: 'focBBB' },
      { type: 'setSectionTitle', sectionId: 'secAAA', title: 'Pipeline (wk)' },
    ];
    for (const op of ops) {
      const { data, error } = await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: op, p_email: email });
      expect(error).toBeNull();
      oracle = applyOp(oracle, op, { email, now: 0 });
    }
    const { data } = await sb.from('hub_weekly_sync').select('items').eq('week_key', WEEK).eq('column_key', COL).single();
    const dbCol = readColumn(data!.items);
    // Compare structure + html + authorship (ignore timestamps: oracle uses now:0, DB uses clock).
    const strip = (c: ColumnData) => c.sections.map((s) => ({ id: s.id, title: s.title, by: s.by, focuses: s.focuses.map((f) => ({ id: f.id, html: f.html, by: f.by, editedBy: f.editedBy })) }));
    expect(strip(dbCol)).toEqual(strip(oracle));
  });

  it('two concurrent upserts to different focuses both survive', async () => {
    await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK);
    await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'addSection', section: { id: 'secCON', title: '' } }, p_email: 'a@iastaffing.com' });
    await Promise.all([
      sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'upsertFocus', sectionId: 'secCON', focus: { id: 'fX', html: 'X' } }, p_email: 'a@iastaffing.com' }),
      sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'upsertFocus', sectionId: 'secCON', focus: { id: 'fY', html: 'Y' } }, p_email: 'b@iastaffing.com' }),
    ]);
    const { data } = await sb.from('hub_weekly_sync').select('items').eq('week_key', WEEK).eq('column_key', COL).single();
    const ids = readColumn(data!.items).sections[0].focuses.map((f) => f.id).sort();
    expect(ids).toEqual(['fX', 'fY']);  // NO lost update — the bug this whole pass fixes
  });
});
```

- [ ] **Step 3: Run it against the real DB**

Run: `RUN_DB_IT=1 npx vitest run src/lib/hub/sync-rpc.integration.test.ts` (with `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `.dev.vars`, e.g. via `dotenv -e .dev.vars --`).
Expected: PASS — including the **no-lost-update** concurrency test. If the parity test fails, the plpgsql diverged from the oracle → fix the migration (Task 4) and re-run until green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/hub/sync-rpc.integration.test.ts
git commit -m "test(hub): Weekly Sync RPC↔oracle parity + no-lost-update integration test"
```

---

## Task 9: Full-suite gate + live verification + code review

- [ ] **Step 1: Full test suite + build**

Run: `npx vitest run && npm run build && node scripts/verify-build.mjs`
Expected: all green (the existing ~400 tests + the new ones; build OK; verify-build OK).

- [ ] **Step 2: Live verify against the real DB (preview-passcode path)**

Per spec §A1 local path: create `.dev.vars` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HUB_SESSION_SECRET`, `HUB_PREVIEW_PASSCODE=ims-hub-2026`), `npm run build`, `npx wrangler pages dev dist --port 8788 …`, sign in via passcode. Using Playwright (or two browser contexts), assert:
  - add a focus → reload → it persists with **your** avatar/initials.
  - in a 2nd context, add a focus to the SAME column → within ~4s the first context shows it (poll adoption) **without losing the focus you're typing in**.
  - delete a focus, rename a section, add/remove a section — all persist.
  - 0 app console errors.
  Use an obviously-test week and clean up rows after.

- [ ] **Step 3: code-reviewer agent**

Dispatch the `feature-dev:code-reviewer` (or `pr-review-toolkit:code-reviewer`) agent over the A1 diff. Codex is win32-blocked → tag `[codex-skip:win32-sandbox]`. Fold any high/medium findings; re-run Step 1.

- [ ] **Step 4: Final commit / ready-for-ship marker**

```bash
git add -A && git commit -m "chore(hub): Weekly Sync A1 — full-suite green + live-verified (no lost edits + attribution)"
```

> **Do NOT deploy to prod here.** Prod ship is a separate, Zach-gated step (`wrangler pages deploy dist --project-name=ims-website --branch=main`), and only Zach can Google-sign-in to verify. Hand back for his go.

---

## Self-review checklist (run after writing; fix inline)

- **Spec coverage:** §4 v3 model → Tasks 1-2; §5 RPC + ops + version + GET widening + per-focus adoption → Tasks 4-6; §6.1 roster → Task 3; §6.2/6.3 attribution + server-stamp → Tasks 5-7. reorder/move/react/carry-over/presence/mentions/links explicitly deferred (A2-A4).
- **Type consistency:** `SyncOp`, `applyOp(column, op, ctx)`, `Focus{by,createdAt,editedBy?,editedAt?}`, RPC `(p_week,p_col,p_op,p_email)→(items,version)`, POST `{weekKey,columnKey,op}`, response `{ok,columnKey,version,column}` — used identically across Tasks 2/4/5/6/8.
- **No placeholders:** the only intentional placeholder is the roster email keys (`*@CONFIRM`), explicitly called out as non-blocking with a fill-in note (Task 3). No "TODO/implement later" in code steps.
- **Open dependencies:** apply migration to prod DB (Task 8 step 1) — Zach-gated with the prod ship; confirm roster emails (drop-in, non-blocking).
