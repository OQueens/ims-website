# Weekly Sync — Phase A1: Atomic Write Engine + v3 Model + Server-Stamped Attribution — Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **v2 folds a 4-lens adversarial plan review** (plpgsql correctness, client-diff applicability, contract consistency, test adequacy). All findings were valid; the fixes are baked in below.

**Goal:** Replace the board's blind whole-column upserts with atomic, operation-based writes applied by a single Postgres function, evolve stored data to model v3 (typed per-focus metadata), and make authorship server-stamped — so no concurrent edit is ever silently lost and every focus shows who wrote it. The board stays behaviorally identical for the user (incl. a working Reset), just lossless + attributed.

**Architecture:** The client sends ONE intent at a time (`{weekKey, columnKey, op}`) to `POST /hub/api/sync`. The endpoint (service-role) calls a `SECURITY DEFINER` Postgres RPC `hub_sync_apply` that takes an advisory lock on `(week, column)`, reads the row, applies the single op to the `items` jsonb, bumps `version` **only if the items actually changed**, and returns `(r_items, r_version)`. The endpoint wraps `r_items` through `readColumn` and responds `{ok, columnKey, version, column}`. A pure-TS `applyOp` mirrors the merge for snappy optimistic UI and as a test oracle; an integration test asserts the RPC and oracle agree (incl. a no-lost-update concurrency test). The GET/poll response widens to carry the new metadata + `version`, and poll adoption becomes per-focus (never freezes during editing, never clobbers the focus holding the caret).

**Tech Stack:** Astro SSR on Cloudflare Pages (Workers), `@supabase/supabase-js` (service-role, server-only), Supabase Postgres (plpgsql), vitest. Magenta Noir CSS tokens. Primary shell is **PowerShell** (Windows) — env-var syntax matters for the integration test.

**Scope (A1 — SIX ops):** `upsertFocus`, `deleteFocus`, `setSectionTitle`, `addSection`, `deleteSection`, `clearColumn` (the last powers the existing Reset button under the op model). **Out of A1** (later sub-phases): `reorderFocus`/`moveFocus` (A4), `setReaction` (A2), `carryOver` (A3), presence (A2), mentions/notifications (A3), links/keyboard (A4), Realtime (Phase B), AI rollup (Phase C). Their absence from A1 is correct, not a gap.

**Reference:** spec `docs/superpowers/specs/2026-06-15-hub-weekly-sync-innovation-design.md` (§4 data model, §5 write protocol, §6.1–6.3 roster/attribution).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `migrations/20260615_hub_weekly_sync_v3.sql` | Create | `version int` column + `hub_sync_apply_section` + `hub_sync_apply` RPC (helper defined FIRST) + REVOKE |
| `src/lib/hub/sync-ops.ts` | Create | `SyncOp` union (6 ops), `applyOp` pure oracle (idempotent), `validateOp` |
| `src/lib/hub/sync-merge.ts` | Create | `comparableCol` (hashes attribution) + `mergeAdopt` (caret-preserving) — pure, unit-tested |
| `src/lib/hub/hub-roster.ts` | Create | `HUB_ROSTER` (email → name/color/initials) + degradation |
| `src/lib/hub/sync-data.ts` | Modify | v3 `Focus`/`Section`/`ColumnData`; widen `normalizeSections`/`readColumn`; bump all `v:2`→`v:3`; caps |
| `src/pages/hub/api/sync.ts` | Modify | POST `{weekKey,columnKey,op}` → RPC → `{ok,columnKey,version,column}`; GET returns `version`+v3 metadata |
| `src/pages/hub/index.astro` | Modify | derive `me` (session email via verifySession) + pass to `<SyncView>` |
| `src/components/hub/SyncView.astro` | Modify | `me: string` Prop → island JSON |
| `src/components/hub/hub-client.ts` | Modify | op-based writes (`sendOp` + supersession guard), per-focus adopt via `mergeAdopt`, `v:2`→`v:3` (4 literals), Reset via `clearColumn`, attribution avatars, `me` |
| `src/styles/hub.css` | Modify | `.sync2-item__avatar` styles (Magenta Noir) |
| `src/lib/hub/sync-ops.test.ts` | Create | `applyOp` (every op, idempotency-on-no-change, edit-stamp, caps) + `validateOp` |
| `src/lib/hub/sync-merge.test.ts` | Create | `comparableCol` (attribution sensitivity) + `mergeAdopt` (caret preservation) |
| `src/lib/hub/hub-roster.test.ts` | Create | roster lookup + degradation |
| `src/lib/hub/sync-data.test.ts` | Modify | v1/v2→**v3** read enrichment; metadata preserved; update existing `v).toBe(2)` → `3` |
| `src/lib/hub/sync-endpoint.test.ts` | Modify | op POST validation/stamping; widened GET (version); **rewrite the obsolete legacy-body 503/400 tests** |
| `src/lib/hub/sync-rpc.integration.test.ts` | Create | env-gated (fail-loud), real RPC vs `applyOp` parity + no-lost-update; richer fixtures |

### Shared contracts (LOCKED — every task matches these exactly)

```ts
// sync-data.ts
export interface Focus {
  id: string; html: string;
  by: string;            // author email; '' when unknown (migrated rows)
  createdAt: number;     // unix seconds; 0 when unknown
  editedBy?: string; editedAt?: number;
}
export interface Section { id: string; title: string; by?: string; focuses: Focus[]; }
export interface ColumnData { v: 3; sections: Section[]; }   // `v` synthetic, never persisted (items stores sections[])

// sync-ops.ts
export type SyncOp =
  | { type: 'upsertFocus'; sectionId: string; focus: { id: string; html: string } }
  | { type: 'deleteFocus'; sectionId: string; focusId: string }
  | { type: 'setSectionTitle'; sectionId: string; title: string }
  | { type: 'addSection'; section: { id: string; title?: string } }
  | { type: 'deleteSection'; sectionId: string }
  | { type: 'clearColumn' };
export interface ApplyCtx { email: string; now: number; }
export function applyOp(column: ColumnData, op: SyncOp, ctx: ApplyCtx): ColumnData;
export function validateOp(raw: unknown): { ok: true; op: SyncOp } | { ok: false; reason: string };
```

- **RPC (LOCKED):** `public.hub_sync_apply(p_week text, p_col text, p_op jsonb, p_email text) RETURNS TABLE(r_items jsonb, r_version int)` — output columns named `r_items`/`r_version` (NOT `items`/`version`) to avoid shadowing the table columns inside the body.
- **POST request (LOCKED):** `{ weekKey: string, columnKey: ColumnKey, op: SyncOp }`.
- **POST response (LOCKED):** `{ ok: true, columnKey: string, version: number, column: ColumnData }` (`column = readColumn(r_items)`).
- **GET response (LOCKED):** `{ ok: true, week: string, columns: Record<ColumnKey, { v: 3; version: number; sections: Section[] }> }`.
- **Attribution rule (LOCKED, §6.3):** the op carries NO `by`/`createdAt`/`editedBy`. The RPC/oracle stamp `by`=author on create, and `editedBy`/`editedAt` **only when `html` actually changes** (idempotent-on-no-change → retry-safe). The server uses `p_email` (authenticated session) as the authority; clients cannot spoof authorship.

---

## Task 1: Data model v3 — interfaces, caps, normalize widening (+ fix existing v2 assertions)

**Files:** Modify `src/lib/hub/sync-data.ts`; Modify `src/lib/hub/sync-data.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `sync-data.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { readColumn, type Focus } from './sync-data';

describe('v3 read enrichment', () => {
  it('migrates a v1 string[] item to a v3 focus with empty attribution', () => {
    const col = readColumn(['Ship the thing'], (p) => p + '_x');
    expect(col.v).toBe(3);
    const f = col.sections[0].focuses[0] as Focus;
    expect(f.html).toBe('Ship the thing');
    expect(f.by).toBe('');
    expect(f.createdAt).toBe(0);
  });
  it('preserves by/createdAt/editedBy/editedAt on a stored focus', () => {
    const stored = [{ id: 'sec1', title: 'T', focuses: [
      { id: 'foc1', html: '<b>x</b>', by: 'a@iastaffing.com', createdAt: 100, editedBy: 'b@iastaffing.com', editedAt: 200 },
    ] }];
    const f = readColumn(stored, (p) => p + '_x').sections[0].focuses[0];
    expect(f).toMatchObject({ id: 'foc1', by: 'a@iastaffing.com', createdAt: 100, editedBy: 'b@iastaffing.com', editedAt: 200 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/hub/sync-data.test.ts -t "v3 read enrichment"`
Expected: FAIL (`by`/`createdAt` undefined; `col.v` is 2).

- [ ] **Step 3: Update interfaces + caps** in `sync-data.ts`

Replace the `Focus`/`Section`/`ColumnData` block (currently ~lines 27-29) with the LOCKED interfaces above. Add `export const MAX_EMAIL_LEN = 120;` near the other caps.

- [ ] **Step 4: Bump every `v: 2` → `v: 3` in `sync-data.ts`**

There are FOUR (`emptyColumn` return; and three `normalizeColumn` returns ~lines 164/167/171 plus `emptyColumn()` call at 173). Change each `{ v: 2, ... }` literal to `{ v: 3, ... }`. (Leave any `v: 2` used as INPUT in tests alone — see Step 7.)

- [ ] **Step 5: Widen `normalizeSections` to carry metadata** — replace the focus `.map(...)` with:

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

Add `by: cleanEmail(s.by) || undefined` to the returned section object. Add helpers near `cleanId`:

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

In the v1 `string[]` migration branch, each focus becomes `{ id: gen('f'), html: escapeText((s as string).trim()), by: '', createdAt: 0 }`.

- [ ] **Step 6: Update the existing v2 assertions** in `sync-data.test.ts`

Grep for output assertions `.v).toBe(2)` (the existing tests at ~lines 109 and 201 assert a migrated column's `.v === 2`). Change those two to `.toBe(3)` and rename the "...migrated v2 column" test title to "v3". **Do NOT** change `v: 2` values used as *input* to `normalizeColumn`/`readColumn` (those test backward-compat reads and must stay).

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/lib/hub/sync-data.test.ts && npx astro check 2>&1 | tail -20`
Expected: PASS; `astro check` shows no NEW errors from `sync-data.ts` (other files still reference `{v:2}` until Tasks 5-6 — that's expected; note any such errors but they're addressed there).

- [ ] **Step 8: Commit**

```bash
git add src/lib/hub/sync-data.ts src/lib/hub/sync-data.test.ts
git commit -m "feat(hub): Weekly Sync data model v3 — typed focus attribution metadata"
```

---

## Task 2: `applyOp` oracle + `validateOp` (6 ops, idempotent-on-no-change)

**Files:** Create `src/lib/hub/sync-ops.ts`; Create `src/lib/hub/sync-ops.test.ts`

- [ ] **Step 1: Write the failing test** (`src/lib/hub/sync-ops.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { applyOp, validateOp, type SyncOp } from './sync-ops';
import { emptyColumn, type ColumnData } from './sync-data';

const ctx = { email: 'zach@iastaffing.com', now: 1000 };
const withSection = (): ColumnData => ({ v: 3, sections: [{ id: 'sec1', title: '', focuses: [] }] });

describe('applyOp', () => {
  it('upsertFocus creates a focus stamped with author + createdAt, no editedBy', () => {
    const out = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'hi' } }, ctx);
    expect(out.sections[0].focuses[0]).toMatchObject({ id: 'f1', html: 'hi', by: 'zach@iastaffing.com', createdAt: 1000 });
    expect(out.sections[0].focuses[0].editedBy).toBeUndefined();
  });
  it('re-applying an IDENTICAL create op is a true no-op (idempotent, retry-safe)', () => {
    const op: SyncOp = { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } };
    const once = applyOp(withSection(), op, ctx);
    const twice = applyOp(once, op, { email: 'matt@iastaffing.com', now: 9999 });
    expect(twice).toEqual(once);              // NO editedBy/editedAt added on identical re-apply
  });
  it('upsertFocus with DIFFERENT html stamps editedBy/editedAt, keeps original by/createdAt', () => {
    let col = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'a' } }, ctx);
    col = applyOp(col, { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'b' } }, { email: 'matt@iastaffing.com', now: 2000 });
    expect(col.sections[0].focuses[0]).toMatchObject({ html: 'b', by: 'zach@iastaffing.com', createdAt: 1000, editedBy: 'matt@iastaffing.com', editedAt: 2000 });
  });
  it('deleteFocus removes by id; no-op when absent', () => {
    let col = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } }, ctx);
    col = applyOp(col, { type: 'deleteFocus', sectionId: 'sec1', focusId: 'f1' }, ctx);
    expect(col.sections[0].focuses).toHaveLength(0);
    expect(applyOp(col, { type: 'deleteFocus', sectionId: 'sec1', focusId: 'f1' }, ctx)).toEqual(col);
  });
  it('setSectionTitle sets by id', () => {
    expect(applyOp(withSection(), { type: 'setSectionTitle', sectionId: 'sec1', title: 'Recruiting' }, ctx).sections[0].title).toBe('Recruiting');
  });
  it('addSection appends stamped section; idempotent by id; no-title allowed', () => {
    let col = applyOp(emptyColumn(), { type: 'addSection', section: { id: 's2' } }, ctx);
    expect(col.sections[0]).toMatchObject({ id: 's2', title: '', by: 'zach@iastaffing.com' });
    col = applyOp(col, { type: 'addSection', section: { id: 's2', title: 'Ops' } }, ctx);
    expect(col.sections).toHaveLength(1);     // idempotent by id
  });
  it('deleteSection removes by id', () => {
    expect(applyOp(withSection(), { type: 'deleteSection', sectionId: 'sec1' }, ctx).sections).toHaveLength(0);
  });
  it('clearColumn empties all sections', () => {
    let col = applyOp(withSection(), { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } }, ctx);
    expect(applyOp(col, { type: 'clearColumn' }, ctx)).toEqual({ v: 3, sections: [] });
  });
  it('respects MAX_FOCUSES and MAX_SECTIONS caps', () => {
    let col = withSection();
    for (let i = 0; i < 60; i++) col = applyOp(col, { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f' + i, html: 'x' } }, ctx);
    expect(col.sections[0].focuses.length).toBe(50);
    let c2: ColumnData = emptyColumn();
    for (let i = 0; i < 20; i++) c2 = applyOp(c2, { type: 'addSection', section: { id: 's' + i } }, ctx);
    expect(c2.sections.length).toBe(16);
  });
  it('does not mutate its input', () => {
    const input = withSection(); const snap = JSON.stringify(input);
    applyOp(input, { type: 'upsertFocus', sectionId: 'sec1', focus: { id: 'f1', html: 'x' } }, ctx);
    expect(JSON.stringify(input)).toBe(snap);
  });
});

describe('validateOp', () => {
  it('accepts a well-formed upsertFocus', () => {
    expect(validateOp({ type: 'upsertFocus', sectionId: 'sec1xx', focus: { id: 'f1xxx', html: 'x' } }).ok).toBe(true);
  });
  it('accepts clearColumn (no fields)', () => { expect(validateOp({ type: 'clearColumn' }).ok).toBe(true); });
  it('accepts addSection without a title', () => {
    const r = validateOp({ type: 'addSection', section: { id: 'secNoT' } });
    expect(r.ok && (r.op as any).section.title).toBeUndefined();   // optional preserved
  });
  it('rejects unknown op + missing fields', () => {
    expect(validateOp({ type: 'nope' }).ok).toBe(false);
    expect(validateOp({ type: 'deleteFocus', sectionId: 'sec1xx' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/hub/sync-ops.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/hub/sync-ops.ts`**

```ts
// Pure operation algebra for Weekly Sync. ONE op at a time, applied to a
// ColumnData. Used by (a) the client for optimistic UI, (b) vitest as the test
// oracle, (c) mirrored by the hub_sync_apply Postgres RPC (the authoritative
// atomic apply). Never mutates input. IDEMPOTENT: re-applying an identical op is
// a no-op (retry-safe) — upsertFocus only stamps editedBy/editedAt when html
// actually changes. A1 covers six ops.
import {
  type ColumnData, type Focus, type Section,
  sanitizeHtml, escapeText, MAX_FOCUSES, MAX_SECTIONS, MAX_TITLE_LEN,
} from './sync-data';

export type SyncOp =
  | { type: 'upsertFocus'; sectionId: string; focus: { id: string; html: string } }
  | { type: 'deleteFocus'; sectionId: string; focusId: string }
  | { type: 'setSectionTitle'; sectionId: string; title: string }
  | { type: 'addSection'; section: { id: string; title?: string } }
  | { type: 'deleteSection'; sectionId: string }
  | { type: 'clearColumn' };

export interface ApplyCtx { email: string; now: number; }

const ID_RE = /^[A-Za-z0-9_-]{3,40}$/;
const cloneCol = (c: ColumnData): ColumnData => ({ v: 3, sections: c.sections.map((s) => ({ ...s, focuses: s.focuses.map((f) => ({ ...f })) })) });

export function applyOp(column: ColumnData, op: SyncOp, ctx: ApplyCtx): ColumnData {
  const col = cloneCol(column);
  switch (op.type) {
    case 'upsertFocus': {
      const sec = col.sections.find((s) => s.id === op.sectionId);
      if (!sec) return col;
      const html = sanitizeHtml(op.focus.html);
      const existing = sec.focuses.find((f) => f.id === op.focus.id);
      if (existing) {
        if (existing.html === html) return col;     // identical → true no-op (retry-safe; no edit stamp)
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
      if (col.sections.some((s) => s.id === op.section.id)) return col;   // idempotent by id
      if (col.sections.length >= MAX_SECTIONS) return col;
      const section: Section = { id: op.section.id, title: escapeText(op.section.title ?? '').slice(0, MAX_TITLE_LEN), by: ctx.email, focuses: [] };
      col.sections.push(section);
      return col;
    }
    case 'deleteSection':
      col.sections = col.sections.filter((s) => s.id !== op.sectionId);
      return col;
    case 'clearColumn':
      return { v: 3, sections: [] };
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
      // Preserve title OPTIONALITY to match the SyncOp type (only include when present).
      const section = s.title !== undefined ? { id: s.id as string, title: s.title as string } : { id: s.id as string };
      return { ok: true, op: { type: 'addSection', section } };
    }
    case 'deleteSection':
      if (!isCleanId(o.sectionId)) return { ok: false, reason: 'bad-deleteSection' };
      return { ok: true, op: { type: 'deleteSection', sectionId: o.sectionId } };
    case 'clearColumn':
      return { ok: true, op: { type: 'clearColumn' } };
    default:
      return { ok: false, reason: 'unknown-op-type' };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/hub/sync-ops.test.ts`
Expected: PASS (all cases incl. idempotency-on-no-change + caps).

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub/sync-ops.ts src/lib/hub/sync-ops.test.ts
git commit -m "feat(hub): Weekly Sync op algebra — idempotent applyOp + validateOp (6 ops)"
```

---

## Task 3: `sync-merge.ts` — comparable + caret-preserving adopt (pure, unit-tested)

**Files:** Create `src/lib/hub/sync-merge.ts`; Create `src/lib/hub/sync-merge.test.ts`

- [ ] **Step 1: Write the failing test** (`src/lib/hub/sync-merge.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { comparableCol, mergeAdopt } from './sync-merge';
import type { ColumnData } from './sync-data';

const mk = (html: string, by = 'a@x.io', editedBy?: string, editedAt?: number): ColumnData => ({
  v: 3, sections: [{ id: 'sec1', title: 'T', focuses: [{ id: 'f1', html, by, createdAt: 1, ...(editedBy ? { editedBy } : {}), ...(editedAt ? { editedAt } : {}) }] }],
});

describe('comparableCol', () => {
  it('differs when html changes', () => { expect(comparableCol(mk('a'))).not.toBe(comparableCol(mk('b'))); });
  it('differs when ONLY attribution changes (by/editedBy/editedAt)', () => {
    expect(comparableCol(mk('a', 'a@x.io'))).not.toBe(comparableCol(mk('a', 'b@x.io')));
    expect(comparableCol(mk('a', 'a@x.io', 'c@x.io', 5))).not.toBe(comparableCol(mk('a', 'a@x.io', 'd@x.io', 5)));
  });
  it('ignores empty untitled sections (cosmetic churn)', () => {
    const withEmpty: ColumnData = { v: 3, sections: [{ id: 's', title: '', focuses: [] }] };
    expect(comparableCol(withEmpty)).toBe(comparableCol({ v: 3, sections: [] }));
  });
});

describe('mergeAdopt', () => {
  it('adopts the incoming column wholesale when no caret', () => {
    expect(mergeAdopt(mk('old'), mk('new'), null)).toEqual(mk('new'));
  });
  it('preserves the live focus the caret is in, adopts the rest', () => {
    const current: ColumnData = { v: 3, sections: [{ id: 'sec1', title: 'T', focuses: [
      { id: 'f1', html: 'MY LIVE TYPING', by: 'me@x.io', createdAt: 1 },
      { id: 'f2', html: 'old', by: 'a@x.io', createdAt: 1 },
    ] }] };
    const incoming: ColumnData = { v: 3, sections: [{ id: 'sec1', title: 'T', focuses: [
      { id: 'f1', html: 'server version', by: 'me@x.io', createdAt: 1 },
      { id: 'f2', html: 'NEW from teammate', by: 'a@x.io', createdAt: 1 },
    ] }] };
    const out = mergeAdopt(current, incoming, 'f1');
    expect(out.sections[0].focuses.find((f) => f.id === 'f1')!.html).toBe('MY LIVE TYPING'); // protected
    expect(out.sections[0].focuses.find((f) => f.id === 'f2')!.html).toBe('NEW from teammate'); // adopted
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/hub/sync-merge.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/hub/sync-merge.ts`**

```ts
// Pure helpers for poll/response adoption in the Weekly Sync client. Extracted
// so the comparable key (which gates whether a poll adopts) and the caret-
// preserving merge can be unit-tested independently of the DOM IIFE.
import type { ColumnData } from './sync-data';

// A stable string of a column's MEANINGFUL content — includes attribution
// (by/editedBy/editedAt) so an attribution-only change still triggers adoption
// (spec §5.4). Empty untitled sections are dropped so cosmetic churn is ignored.
export function comparableCol(cd: ColumnData): string {
  return JSON.stringify(
    cd.sections
      .filter((s) => s.focuses.length > 0 || s.title.trim() !== '')
      .map((s) => ({
        t: s.title,
        f: s.focuses.map((x) => x.id + ':' + x.html + ':' + (x.by || '') + ':' + (x.editedBy || '') + ':' + (x.editedAt || 0)),
      })),
  );
}

// Adopt `incoming`, but if `caretFocusId` is a focus the user is actively typing
// in, keep the LIVE local copy of that one focus (so a poll/response never yanks
// text out from under the caret). Everything else adopts.
export function mergeAdopt(current: ColumnData, incoming: ColumnData, caretFocusId: string | null): ColumnData {
  if (!caretFocusId) return incoming;
  const live = current.sections.flatMap((s) => s.focuses).find((f) => f.id === caretFocusId);
  if (!live) return incoming;
  return {
    v: 3,
    sections: incoming.sections.map((s) => ({
      ...s,
      focuses: s.focuses.map((f) => (f.id === caretFocusId ? live : f)),
    })),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/hub/sync-merge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub/sync-merge.ts src/lib/hub/sync-merge.test.ts
git commit -m "feat(hub): Weekly Sync merge helpers — attribution-aware comparable + caret-preserving adopt"
```

---

## Task 4: Roster (`hub-roster.ts`)

**Files:** Create `src/lib/hub/hub-roster.ts`; Create `src/lib/hub/hub-roster.test.ts`

- [ ] **Step 1: Write the failing test** (`src/lib/hub/hub-roster.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { rosterEntry } from './hub-roster';

describe('rosterEntry', () => {
  it('returns the seeded entry for a known (exact, lowercase) key', () => {
    const e = rosterEntry('zach@confirm');   // matches a SEED key (keys are lowercase)
    expect(e.name).toBe('Zach');
    expect(e.initials).toBe('Z');
    expect(e.color).toMatch(/^#/);
  });
  it('degrades for an unknown email: local-part name, derived initial, deterministic color', () => {
    const a = rosterEntry('someone.new@imstaffing.ai');
    const b = rosterEntry('SOMEONE.NEW@imstaffing.ai');   // case-insensitive
    expect(a.initials).toBe('S');
    expect(a.name).toBe('someone.new');
    expect(a.color).toBe(b.color);
  });
  it('handles empty author email', () => {
    expect(rosterEntry('')).toMatchObject({ name: 'Unknown', initials: '?' });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/hub/hub-roster.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement `src/lib/hub/hub-roster.ts`**

```ts
// The 6-person management roster for Weekly Sync attribution. Email is the
// authoritative key (matched against the authenticated hub session email).
// ⚠️ CONFIRM: the *@confirm keys are PLACEHOLDERS — replace with the real work
// emails when Zach provides them (KEYS MUST BE LOWERCASE; rosterEntry lowercases
// input before lookup). Names/initials/colours are final. Unknown emails degrade
// gracefully — the board never crashes and authorship is never fabricated.
export interface RosterEntry { name: string; initials: string; color: string; }

const SEED: Record<string, RosterEntry> = {
  'zach@confirm':    { name: 'Zach',    initials: 'Z', color: '#C44569' }, // mn-magenta
  'donovan@confirm': { name: 'Donovan', initials: 'D', color: '#59BFE7' }, // mn-cyan
  'chad@confirm':    { name: 'Chad',    initials: 'C', color: '#E8C465' }, // mn-butter
  'matt@confirm':    { name: 'Matt',    initials: 'M', color: '#7FB069' }, // sage
  'brent@confirm':   { name: 'Brent',   initials: 'B', color: '#B388EB' }, // soft violet
  'jon@confirm':     { name: 'Jon',     initials: 'J', color: '#F08A5D' }, // warm coral
};
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
  return { name: local, initials: (local[0] || '?').toUpperCase(), color: FALLBACK_COLORS[hash(key) % FALLBACK_COLORS.length] };
}

export function rosterPickerList(): { email: string; name: string }[] {
  return Object.entries(SEED).map(([email, e]) => ({ email, name: e.name }));
}
```

- [ ] **Step 4: Run to verify it passes** — `npx vitest run src/lib/hub/hub-roster.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hub/hub-roster.ts src/lib/hub/hub-roster.test.ts
git commit -m "feat(hub): Weekly Sync roster (placeholder lowercase keys) + graceful degradation"
```

---

## Task 5: Migration — `version` column + `hub_sync_apply` RPC

**Files:** Create `migrations/20260615_hub_weekly_sync_v3.sql`

> No vitest (no Postgres in CI). Verified by Task 9's env-gated integration test against the real DB. Apply it to the DB in Task 9 Step 1.

- [ ] **Step 1: Write the migration** (note: helper defined FIRST; `date_part` not `extract`; caps enforced; ordered rebuilds; NULL-safe; no-op version guard; renamed OUT columns)

```sql
-- IMS Hub — Weekly Sync v3 write engine — 2026-06-15
-- Adds optimistic-concurrency `version` + an atomic, op-based apply function so
-- concurrent edits in the same column cannot silently overwrite each other.
-- The browser NEVER calls this; only the service-role /hub/api/sync endpoint does.
-- Mirrors src/lib/hub/sync-ops.ts applyOp (A1: 6 ops). HTML/title are stored
-- raw here and normalized+escaped+sanitized on READ by readColumn (sync-data.ts),
-- matching the existing sanitize-on-read posture — the RPC contains NO sanitizer.

ALTER TABLE public.hub_weekly_sync
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 0;

-- Helper FIRST (no forward reference): apply a section-targeted op to ONE section,
-- returning the new section jsonb. Caps focuses at 50 (mirrors MAX_FOCUSES).
CREATE OR REPLACE FUNCTION public.hub_sync_apply_section(
  s jsonb, p_op jsonb, p_email text, p_now bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_type   text := p_op->>'type';
  v_foc_id text;
  v_html   text;
  v_focs   jsonb;
  v_exists boolean;
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
    v_exists := EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(s->'focuses') f WHERE f->>'id' = v_foc_id);
    IF v_exists THEN
      -- update in place ONLY when html differs (idempotent-on-no-change → retry-safe)
      SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(
        CASE WHEN f->>'id' = v_foc_id AND f->>'html' IS DISTINCT FROM v_html
             THEN f || pg_catalog.jsonb_build_object('html', v_html, 'editedBy', p_email, 'editedAt', p_now)
             ELSE f END
        ORDER BY ord), '[]'::jsonb) INTO v_focs
        FROM pg_catalog.jsonb_array_elements(s->'focuses') WITH ORDINALITY AS t(f, ord);
    ELSE
      -- append only if under the 50-focus cap (mirrors MAX_FOCUSES)
      IF pg_catalog.jsonb_array_length(s->'focuses') < 50 THEN
        SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(f ORDER BY ord), '[]'::jsonb) INTO v_focs
          FROM pg_catalog.jsonb_array_elements(s->'focuses') WITH ORDINALITY AS t(f, ord);
        v_focs := v_focs || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'id', v_foc_id, 'html', v_html, 'by', p_email, 'createdAt', p_now));
      ELSE
        v_focs := s->'focuses';
      END IF;
    END IF;
    RETURN pg_catalog.jsonb_set(s, '{focuses}', v_focs);
  END IF;

  RETURN s;
END;
$$;

-- Main: lock (week,col), read (creating a blank row if absent), apply ONE op,
-- bump version ONLY if items changed, return (r_items, r_version). OUT columns
-- are r_* to avoid shadowing the table's items/version inside the body.
CREATE OR REPLACE FUNCTION public.hub_sync_apply(
  p_week  text,
  p_col   text,
  p_op    jsonb,
  p_email text
) RETURNS TABLE(r_items jsonb, r_version int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lock_key bigint;
  v_items    jsonb;
  v_new      jsonb;
  v_ver      int;
  v_type     text := p_op->>'type';
  v_sec_id   text := p_op->>'sectionId';
  v_now      bigint := pg_catalog.floor(pg_catalog.date_part('epoch', pg_catalog.clock_timestamp()))::bigint;
BEGIN
  IF p_col IS NULL OR p_col NOT IN ('recruiting','marketing','operations') THEN
    RAISE EXCEPTION 'bad-column: %', p_col;
  END IF;
  IF p_week IS NULL OR p_email IS NULL THEN
    RAISE EXCEPTION 'missing-week-or-email';
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

  IF v_type = 'clearColumn' THEN
    v_new := '[]'::jsonb;

  ELSIF v_type = 'addSection' THEN
    IF pg_catalog.jsonb_array_length(v_items) < 16
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_items) s WHERE s->>'id' = p_op->'section'->>'id') THEN
      v_new := v_items || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id', p_op->'section'->>'id',
        'title', pg_catalog.left(pg_catalog.coalesce(p_op->'section'->>'title',''), 80),
        'by', p_email,
        'focuses', '[]'::jsonb));
    ELSE
      v_new := v_items;
    END IF;

  ELSIF v_type = 'deleteSection' THEN
    SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(s ORDER BY ord), '[]'::jsonb) INTO v_new
      FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS t(s, ord)
      WHERE s->>'id' <> (p_op->>'sectionId');

  ELSE
    -- section-targeted ops (upsertFocus / deleteFocus / setSectionTitle)
    SELECT pg_catalog.coalesce(pg_catalog.jsonb_agg(
      CASE WHEN s->>'id' = v_sec_id THEN public.hub_sync_apply_section(s, p_op, p_email, v_now) ELSE s END
      ORDER BY ord), '[]'::jsonb) INTO v_new
      FROM pg_catalog.jsonb_array_elements(v_items) WITH ORDINALITY AS t(s, ord);
  END IF;

  IF v_new IS DISTINCT FROM v_items THEN
    UPDATE public.hub_weekly_sync hws
      SET items = v_new, version = hws.version + 1, updated_by = p_email, updated_at = pg_catalog.now()
      WHERE hws.week_key = p_week AND hws.column_key = p_col;
    RETURN QUERY SELECT v_new, v_ver + 1;
  ELSE
    RETURN QUERY SELECT v_items, v_ver;   -- genuine no-op: don't bump version / churn the row
  END IF;
END;
$$;

-- Seal: only service_role executes (browser/anon/authenticated never reach the DB).
REVOKE EXECUTE ON FUNCTION public.hub_sync_apply(text, text, jsonb, text)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hub_sync_apply_section(jsonb, jsonb, text, bigint) FROM PUBLIC, anon, authenticated;
```

> Title parity note: the RPC stores titles raw-truncated; `applyOp` stores `escapeText(title)`; both reconcile because `readColumn` escapes on read (idempotent). Task 9 includes a special-char + >80-char title to lock this. If the >80 boundary ever diverges in the parity test, switch `applyOp` to store raw (escape only on render/read) — but verify via the test first.

- [ ] **Step 2: Commit (apply happens in Task 9)**

```bash
git add migrations/20260615_hub_weekly_sync_v3.sql
git commit -m "feat(hub): Weekly Sync v3 migration — version column + atomic hub_sync_apply RPC (6 ops)"
```

---

## Task 6: Endpoint — op-based POST + widened GET (`sync.ts`)

**Files:** Modify `src/pages/hub/api/sync.ts`; Modify `src/lib/hub/sync-endpoint.test.ts`

- [ ] **Step 1: Rewrite/replace the endpoint tests** (open `sync-endpoint.test.ts`; sibling imports like `./session`)

Add op-validation + reshape the obsolete legacy-body tests. Replace the two existing tests that POST a legacy `{column:{v:2…}}`/`{items:['x']}` body and expect 503/400 with op-shaped equivalents:

```ts
import { validateOp } from './sync-ops';

describe('op POST contract', () => {
  it('validateOp rejects a missing/unknown op before any storage call', () => {
    expect(validateOp(undefined).ok).toBe(false);
    expect(validateOp({ type: 'evil' }).ok).toBe(false);
  });
  it('a VALID op with storage unconfigured returns 503 (not 400)', async () => {
    // (mirror the file's existing request/locals harness; env without SUPABASE_* → getHubSupabase null)
    const res = await POST(makeCtx({ weekKey: '2026-W24', columnKey: 'recruiting', op: { type: 'upsertFocus', sectionId: 'abcd', focus: { id: 'efgh', html: '<b>x</b>' } } }));
    expect(res.status).toBe(503);
  });
  it('a malformed op returns 400 BEFORE any storage check', async () => {
    const res = await POST(makeCtx({ weekKey: '2026-W24', columnKey: 'recruiting', op: { type: 'deleteFocus' } }));
    expect(res.status).toBe(400);
  });
});
```

> Use the file's actual existing harness (`makeCtx`/request builder + authed-session cookie helper) — match its style. **Delete** the now-obsolete legacy `{items:['x']}` 503 test and the "neither column nor items present → 400" test; the body contract is now `{weekKey,columnKey,op}`.

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/hub/sync-endpoint.test.ts` → FAIL.

- [ ] **Step 3: Rewrite the POST handler** in `sync.ts` (replace the body-parse + persist block):

```ts
  // 2) Parse + validate the single-intent op.
  let raw: unknown;
  try { raw = await request.json(); } catch { return json(400, { ok: false, error: 'invalid-json' }); }
  const r = raw as { weekKey?: unknown; columnKey?: unknown; op?: unknown };
  if (!isWeekKey(r.weekKey)) return json(400, { ok: false, error: 'bad-week-key' });
  if (typeof r.columnKey !== 'string' || !(COLUMN_KEYS as readonly string[]).includes(r.columnKey)) return json(400, { ok: false, error: 'bad-column' });
  const parsed = validateOp(r.op);
  if (!parsed.ok) return json(400, { ok: false, error: parsed.reason });

  // Sanitize html the op carries BEFORE the DB (the RPC stores raw).
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
  const column = readColumn(row?.r_items);
  return json(200, { ok: true, columnKey: r.columnKey, version: row?.r_version ?? 0, column });
```

Top-of-file imports: add `sanitizeHtml` from `./../../../lib/hub/sync-data` (match existing relative style) and `validateOp` from `../../../lib/hub/sync-ops`. Keep `readColumn`/`isWeekKey`/`COLUMN_KEYS` imports.

- [ ] **Step 4: Widen the GET response** — add `version` to the select and the per-column payload:

```ts
  const { data, error } = await supabase
    .from('hub_weekly_sync')
    .select('column_key, items, version')   // + version
    .eq('week_key', week);
  // ...
  const columns: Record<string, { v: 3; version: number; sections: ColumnData['sections'] }> = {};
  for (const key of COLUMN_KEYS) columns[key] = { v: 3, version: 0, sections: [] };
  for (const row of data ?? []) {
    const rr = row as { column_key: string; items: unknown; version?: number };
    if ((COLUMN_KEYS as readonly string[]).includes(rr.column_key)) {
      columns[rr.column_key] = { v: 3, version: rr.version ?? 0, sections: readColumn(rr.items).sections };
    }
  }
  return json(200, { ok: true, week, columns });
```

(The `?list=1` branch and the SSR read in `index.astro` intentionally do NOT need `version` — leave them.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/hub/sync-endpoint.test.ts && npx astro check 2>&1 | tail -20`
Expected: PASS; no new type errors in `sync.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/hub/api/sync.ts src/lib/hub/sync-endpoint.test.ts
git commit -m "feat(hub): Weekly Sync endpoint — atomic op POST + version in GET (op body contract)"
```

---

## Task 7: Client — `me` plumbing, op-based writes, per-focus adopt, attribution, Reset

**Files:** Modify `src/pages/hub/index.astro`, `src/components/hub/SyncView.astro`, `src/components/hub/hub-client.ts`

> Verified by Task 9 (Playwright vs real DB). Keep the existing `epoch`/`viewedWeek` guards.

- [ ] **Step 1: Derive `me` in `index.astro` and pass it down**

`index.astro` does NOT currently read the session — add it (mirror `authedEmail` in `sync.ts`). Near the top, after `readHubEnv`:

```astro
import { getCookie } from '../../lib/hub/cookies';
import { verifySession, SESSION_COOKIE } from '../../lib/hub/session';
const _token = getCookie(Astro.request.headers.get('cookie'), SESSION_COOKIE);
const _now = Math.floor(Date.now() / 1000);
const _session = _token && env.HUB_SESSION_SECRET
  ? await verifySession(_token, env.HUB_SESSION_SECRET, _now, env.HUB_SESSION_GENERATION)
  : null;
const me = _session?.email ?? '';
```

Pass `me={me}` to `<SyncView ... />`. (`me` is presentation-only — the server re-stamps authoritatively, so `''` is safe.)

In `SyncView.astro`: add `me: string` to `Props`; include it in the island JSON: `JSON.stringify({ weekKey, data, persisted, me })…`.

- [ ] **Step 2: Extend `SyncIsland` + read `me`** in hub-client.ts

Change `interface SyncIsland { weekKey: string; columns: Columns; weeks: string[]; }` → add `me: string;`. After hydrating `island`, add `const me: string = island?.me ?? '';`.

Add imports at top of hub-client.ts:
```ts
import { applyOp, type SyncOp } from '../../lib/hub/sync-ops';
import { comparableCol, mergeAdopt } from '../../lib/hub/sync-merge';
import { rosterEntry } from '../../lib/hub/hub-roster';
```
(Keep `sanitizeHtml`/`escapeText`/`MAX_TITLE_LEN`/`ColumnData`/`ColumnKey` from sync-data. **Remove** the now-inlined `comparableCol` definition — use the imported one.)

- [ ] **Step 3: Flip the 4 `{ v: 2 }` literals → `{ v: 3 }`** in hub-client.ts: `blankCols()` (~227), `shape()` return (~241), `recoverFromLocal()` reassignment (~283), and the Reset handler clear (~567).

- [ ] **Step 4: Replace `persist()` + timers/pending with `sendOp` (supersession-guarded)**

Remove `timers`, `pending`, and the `persist(col)` function. Add:

```ts
  const colVersion: Partial<Record<ColumnKey, number>> = {};
  let opSeq = 0;
  const latestSeqByFocus = new Map<string, number>();   // (col:foc) → seq, to drop superseded retries

  function activeFocusId(): string | null {
    const a = document.activeElement as HTMLElement | null;
    return a && board!.contains(a) ? (a.dataset?.foc ?? null) : null;
  }
  function adopt(col: ColumnKey, incoming: ColumnData, version?: number) {
    if (typeof version === 'number') {
      if ((colVersion[col] ?? -1) > version) return;     // stale
      colVersion[col] = version;
    }
    const shaped = shape({ [col]: incoming } as Partial<Columns>)[col];
    if (comparableCol(shaped) === comparableCol(cols[col])) return;   // nothing meaningful changed → no DOM churn
    cols[col] = mergeAdopt(cols[col], shaped, activeFocusId());
    ensureSection(cols[col]); saveLocal(); render();
  }
  function sendOp(col: ColumnKey, op: SyncOp, focusKey?: string) {
    saveLocal();
    if (!viewedWeek) return;
    const myEpoch = epoch, myWeek = viewedWeek, mySeq = ++opSeq;
    if (focusKey) latestSeqByFocus.set(col + ':' + focusKey, mySeq);
    setStatus('saving');
    (async () => {
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
          setStatus('saved');
          if (b && b.ok && b.column && epoch === myEpoch && viewedWeek === myWeek) adopt(col, b.column, b.version);
        } else { scheduleRetry(col, op, focusKey, mySeq); }
      } catch (e) {
        if (epoch !== myEpoch || viewedWeek !== myWeek) return;
        scheduleRetry(col, op, focusKey, mySeq);
      }
    })();
  }
  function scheduleRetry(col: ColumnKey, op: SyncOp, focusKey: string | undefined, mySeq: number) {
    setStatus('error');
    setTimeout(() => {
      // drop a stale retry if a newer op for the same focus has since been sent
      if (focusKey && latestSeqByFocus.get(col + ':' + focusKey) !== mySeq) return;
      sendOp(col, op, focusKey);
    }, 3000);
  }
```

> Note: ops commit on blur/click (not per keystroke), preserving today's write cadence — no per-keystroke POST.

- [ ] **Step 5: Convert each bind handler to optimistic `applyOp` + `sendOp`**

In `bind()`, replace each `persist(col); render();` with an op. The `now` helper: `const nowS = () => Math.floor(Date.now()/1000);`

- **Add a focus** (`.sync2-add`):
```ts
  const f = { id: genId('f'), html: '' };
  cols[col] = applyOp(cols[col], { type:'upsertFocus', sectionId: sec, focus: f }, { email: me, now: nowS() });
  render();
  const el = board!.querySelector(`.sync2-item__txt[data-foc="${f.id}"]`) as HTMLElement | null;
  if (el) focusEnd(el);
  sendOp(col, { type:'upsertFocus', sectionId: sec, focus: f }, f.id);
```
- **Focus blur** (text commit): compute `html = readFocusHtml(el)`; if unchanged vs `f.html` return; `cols[col] = applyOp(cols[col], { type:'upsertFocus', sectionId, focus:{ id, html } }, {email:me,now:nowS()})`; `el.innerHTML = html`; `updateCount(col)`; `sendOp(col, {type:'upsertFocus',sectionId,focus:{id,html}}, id)`.
- **Delete focus:** `cols[col]=applyOp(cols[col],{type:'deleteFocus',sectionId,focusId},{email:me,now:nowS()}); sendOp(col,{type:'deleteFocus',sectionId,focusId}); render();`
- **Section title blur:** `{type:'setSectionTitle',sectionId,title}` (optimistic applyOp + sendOp).
- **Add section** (`.sync2-addsec`): `{type:'addSection',section:{id,title:''}}`.
- **Delete section** (`.sync2-sec__del`): `{type:'deleteSection',sectionId}`.

- [ ] **Step 6: Reset via `clearColumn`** — replace the Reset handler body (which used `persist(id)`):

```ts
  $('#sync-reset')?.addEventListener('click', () => {
    const which = viewedWeek === currentWeek ? "this week's" : `the ${viewedWeek}`;
    if (!confirm(`Clear ${which} board for the whole team? This can't be undone.`)) return;
    epoch++;
    colIds.forEach((id) => { cols[id] = { v: 3, sections: [] }; ensureSection(cols[id]); sendOp(id, { type: 'clearColumn' }); });
    render();
  });
```

- [ ] **Step 7: Per-focus poll adoption** — replace `poll()`:

```ts
  async function poll() {
    if (!viewedWeek) return;
    const myWeek = viewedWeek, myEpoch = epoch;
    try {
      const res = await fetch('/hub/api/sync?week=' + encodeURIComponent(myWeek), { credentials: 'same-origin', redirect: 'manual', headers: { Accept: 'application/json' } });
      if (!res.ok || res.type === 'opaqueredirect') return;
      if (myWeek !== viewedWeek || myEpoch !== epoch) return;
      const b = await res.json();
      if (!b || !b.ok || !b.columns || myWeek !== viewedWeek || myEpoch !== epoch) return;
      colIds.forEach((id) => { if (b.columns[id]) adopt(id, b.columns[id], b.columns[id].version); });
    } catch (e) { /* offline; keep local */ }
  }
```

The whole-cycle `activeElement` skip and per-column `pending` gate are GONE — `adopt()` protects only the caret focus (via `mergeAdopt`) and no-ops when nothing meaningful changed.

- [ ] **Step 8: Widen `shape()`** to carry metadata (focus mapping):

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

- [ ] **Step 9: Render attribution avatar** — in `render()` `.sync2-item` template add `${avatarHtml(f)}` as a sibling AFTER the `.sync2-item__txt` div (never inside it). Add:

```ts
  function avatarHtml(f: { by?: string; editedBy?: string }): string {
    const who = f.by || '';
    const e = rosterEntry(who);
    const title = who
      ? `Added by ${esc(e.name)}${f.editedBy && f.editedBy !== who ? ' · edited by ' + esc(rosterEntry(f.editedBy).name) : ''}`
      : 'Author unknown';
    return `<span class="sync2-item__avatar" style="--av:${e.color}" title="${title}" aria-label="${title}">${esc(e.initials)}</span>`;
  }
```

- [ ] **Step 10: Build + typecheck**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds, no TS errors (all `v:2`→`v:3` flipped; `SyncIsland.me` typed). Behavior verified in Task 9.

- [ ] **Step 11: Commit**

```bash
git add src/components/hub/hub-client.ts src/components/hub/SyncView.astro src/pages/hub/index.astro
git commit -m "feat(hub): Weekly Sync client — op writes, per-focus adopt, Reset via clearColumn, attribution"
```

---

## Task 8: Attribution avatar styles (Magenta Noir)

**Files:** Modify `src/styles/hub.css`

- [ ] **Step 1: Add styles** (after the `.sync2-item` block)

```css
.sync2-item__avatar{
  flex:0 0 auto; width:20px; height:20px; border-radius:50%;
  display:inline-grid; place-items:center; font-size:10px; font-weight:700; line-height:1;
  background:var(--av,#8A8A8A); color:var(--mn-black,#0A0A0F);
  user-select:none; opacity:.92;
}
.sync2-item:hover .sync2-item__avatar{ opacity:1; }
```

> Contrast: initials are `--mn-black` on the (light/saturated) avatar hue. If Task 9 screenshots show a low-contrast hue, switch that initial to `--mn-cream` via a luminance check in `avatarHtml`. (Never cream-on-butter; no yellow+purple — already honored by the palette.)

- [ ] **Step 2: Build + commit**

```bash
npm run build 2>&1 | tail -5
git add src/styles/hub.css
git commit -m "style(hub): Weekly Sync attribution avatar (Magenta Noir)"
```

---

## Task 9: Apply migration + integration test (real DB, fail-loud) + full gate + live verify + review

**Files:** Create `src/lib/hub/sync-rpc.integration.test.ts`

- [ ] **Step 1: Apply the migration to the DB**

Use the Supabase MCP (or `psql`/the Supabase SQL editor) to run `migrations/20260615_hub_weekly_sync_v3.sql` against `gbakzhibzotugfyktcrt`. Verify:
```sql
select version from public.hub_weekly_sync limit 1;                                  -- column exists
select * from public.hub_sync_apply('9999-W99','recruiting','{"type":"addSection","section":{"id":"sec_it1","title":"IT<b>&"}}'::jsonb,'it@iastaffing.com');  -- returns (r_items, r_version)
delete from public.hub_weekly_sync where week_key='9999-W99';
```

- [ ] **Step 2: Write the integration test** (FAIL-LOUD when configured-but-missing; richer fixtures)

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { applyOp, type SyncOp } from './sync-ops';
import { readColumn, emptyColumn, type ColumnData } from './sync-data';

const RUN = process.env.RUN_DB_IT === '1';
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEEK = '9999-W99', COL = 'recruiting';

(RUN ? describe : describe.skip)('hub_sync_apply RPC == applyOp oracle (real DB)', () => {
  if (RUN && (!url || !key)) throw new Error('RUN_DB_IT=1 but SUPABASE_URL/SERVICE_ROLE_KEY missing — refusing to masquerade as a pass');
  const sb = createClient(url!, key!);
  afterAll(async () => { await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK); });

  const strip = (c: ColumnData) => c.sections.map((s) => ({ id: s.id, title: s.title, by: s.by,
    focuses: s.focuses.map((f) => ({ id: f.id, html: f.html, by: f.by, editedBy: f.editedBy })) }));

  it('an op sequence yields identical items in DB and oracle (incl. distinct editor, special-char title, hostile html)', async () => {
    await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK);
    let oracle: ColumnData = emptyColumn();
    const apply = async (op: SyncOp, email: string) => {
      const { error } = await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: opForDb(op), p_email: email });
      expect(error).toBeNull();
      oracle = applyOp(oracle, op, { email, now: 0 });
    };
    // endpoint sanitizes upsert html before the RPC; mirror that here:
    const { sanitizeHtml } = await import('./sync-data');
    const opForDb = (op: SyncOp): SyncOp => op.type === 'upsertFocus' ? { ...op, focus: { ...op.focus, html: sanitizeHtml(op.focus.html) } } : op;

    await apply({ type: 'addSection', section: { id: 'secAAA', title: 'Pipe<b>&line' } }, 'zach@iastaffing.com');
    await apply({ type: 'upsertFocus', sectionId: 'secAAA', focus: { id: 'focAAA', html: 'Call <b>CHS</b>' } }, 'zach@iastaffing.com');
    await apply({ type: 'upsertFocus', sectionId: 'secAAA', focus: { id: 'focBAD', html: '<script>alert(1)</script>hi' } }, 'zach@iastaffing.com');
    await apply({ type: 'upsertFocus', sectionId: 'secAAA', focus: { id: 'focAAA', html: 'Call CHS (synced)' } }, 'matt@iastaffing.com'); // edit by DIFFERENT user
    await apply({ type: 'deleteFocus', sectionId: 'secAAA', focusId: 'focBAD' }, 'zach@iastaffing.com');
    await apply({ type: 'setSectionTitle', sectionId: 'secAAA', title: 'Pipe<line' }, 'zach@iastaffing.com');

    const { data } = await sb.from('hub_weekly_sync').select('items').eq('week_key', WEEK).eq('column_key', COL).single();
    const dbCol = readColumn(data!.items);
    expect(strip(dbCol)).toEqual(strip(oracle));
    // editedBy is the DISTINCT editor, not the author:
    const edited = dbCol.sections[0].focuses.find((f) => f.id === 'focAAA')!;
    expect(edited.by).toBe('zach@iastaffing.com');
    expect(edited.editedBy).toBe('matt@iastaffing.com');
  });

  it('two concurrent upserts to DIFFERENT focuses both survive (the no-lost-update guarantee)', async () => {
    await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK);
    await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'addSection', section: { id: 'secCON', title: '' } }, p_email: 'a@iastaffing.com' });
    await Promise.all([
      sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'upsertFocus', sectionId: 'secCON', focus: { id: 'fX', html: 'X' } }, p_email: 'a@iastaffing.com' }),
      sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'upsertFocus', sectionId: 'secCON', focus: { id: 'fY', html: 'Y' } }, p_email: 'b@iastaffing.com' }),
    ]);
    const { data } = await sb.from('hub_weekly_sync').select('items').eq('week_key', WEEK).eq('column_key', COL).single();
    expect(readColumn(data!.items).sections[0].focuses.map((f) => f.id).sort()).toEqual(['fX', 'fY']);
  });

  it('re-applying an identical create op does NOT bump version or add editedBy (idempotent)', async () => {
    await sb.from('hub_weekly_sync').delete().eq('week_key', WEEK);
    await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: { type: 'addSection', section: { id: 'secIDEM' } }, p_email: 'a@iastaffing.com' });
    const op = { type: 'upsertFocus', sectionId: 'secIDEM', focus: { id: 'fI', html: 'same' } };
    const r1 = await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: op, p_email: 'a@iastaffing.com' });
    const r2 = await sb.rpc('hub_sync_apply', { p_week: WEEK, p_col: COL, p_op: op, p_email: 'b@iastaffing.com' });
    const v1 = (Array.isArray(r1.data) ? r1.data[0] : r1.data).r_version;
    const v2 = (Array.isArray(r2.data) ? r2.data[0] : r2.data).r_version;
    expect(v2).toBe(v1);   // no-op didn't bump
    const { data } = await sb.from('hub_weekly_sync').select('items').eq('week_key', WEEK).eq('column_key', COL).single();
    expect(readColumn(data!.items).sections[0].focuses[0].editedBy).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it against the real DB (PowerShell)**

```powershell
$env:RUN_DB_IT='1'; $env:SUPABASE_URL='<from .dev.vars>'; $env:SUPABASE_SERVICE_ROLE_KEY='<from .dev.vars>'; npx vitest run src/lib/hub/sync-rpc.integration.test.ts
```
Expected: PASS — incl. the **no-lost-update** + idempotency tests. If parity fails, the plpgsql diverged from the oracle → fix Task 5 and re-run until green. (Plain `npx vitest run` without those env vars cleanly `describe.skip`s this file — confirm it does not error on the undefined client args.)

- [ ] **Step 4: Full suite + build + verify-build**

Run: `npx vitest run && npm run build && node scripts/verify-build.mjs`
Expected: all green (~400 existing + new; build OK; verify-build OK). No verify-build change is needed for A1 (the v3/version invariants are covered by unit tests).

- [ ] **Step 5: Live verify (preview-passcode path)**

`.dev.vars` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HUB_SESSION_SECRET`, `HUB_PREVIEW_PASSCODE=ims-hub-2026`) → `npm run build` → `npx wrangler pages dev dist --port 8788 …` → sign in via passcode. With two browser contexts (Playwright), assert on an obviously-test week (clean up after):
  - add a focus → reload → persists with **your** avatar/initials.
  - 2nd context adds a focus to the SAME column → within ~4s context 1 shows it **without losing the focus you're typing in** (type continuously in context 1 while context 2 edits — no characters lost).
  - an attribution-only change (2nd context edits a focus) → context 1's "edited by" caption updates within the poll interval.
  - delete focus / rename section / add+remove section / **Reset (clears all three columns + persists)** all work.
  - 0 app console errors.

- [ ] **Step 6: code-reviewer agent**

Dispatch `feature-dev:code-reviewer` (or `pr-review-toolkit:code-reviewer`) over the A1 diff. Codex win32-blocked → tag `[codex-skip:win32-sandbox]`. Fold high/medium findings; re-run Steps 3-4.

- [ ] **Step 7: Final commit (ready-for-ship marker)**

```bash
git add -A && git commit -m "test(hub): Weekly Sync A1 — RPC↔oracle parity + no-lost-update + full-suite green, live-verified"
```

> **Do NOT deploy to prod here.** Prod ship is a separate, Zach-gated step (`wrangler pages deploy dist --project-name=ims-website --branch=main`); only Zach can Google-sign-in to verify. Hand back for his go.

---

## Self-review checklist (post-fold)

- **Spec coverage:** §4 v3 model → Tasks 1-2; §5 RPC+version+GET widening+per-focus adoption → Tasks 5-7; §6.1 roster → Task 4; §6.2/6.3 attribution+server-stamp → Tasks 5-9. reorder/move/react/carry-over/presence/mentions/links deferred (A2-A4). Reset preserved via the new `clearColumn` op.
- **Type consistency:** `SyncOp` (6 variants), `applyOp(column,op,ctx)`, `Focus{by,createdAt,editedBy?,editedAt?}`, RPC `(p_week,p_col,p_op,p_email)→(r_items,r_version)`, POST `{weekKey,columnKey,op}` → `{ok,columnKey,version,column}`, GET `columns[k]={v:3,version,sections}` — identical across Tasks 1/2/5/6/7/9. Client reads `b.column`/`b.version` (Task 7) matching Task 6's response.
- **Folded review findings:** EXTRACT→date_part; caps in RPC; deleteSection ORDER BY; helper-defined-first; NULL-safe guard; no-op version guard; idempotent-on-no-change upsert (oracle+RPC); `clearColumn` op for Reset; `me` via real session read in index.astro + SyncIsland.me; response shape unified to `{ok,columnKey,version,column}`; OUT cols `r_*`; v2→v3 across sync-data(+test)/endpoint-test/hub-client(4 literals); obsolete endpoint tests rewritten; sendOp supersession guard; comparableCol incl. editedBy + extracted/unit-tested; integration test fail-loud + PowerShell invocation + richer fixtures (distinct editor, hostile html, special-char title); roster exact-lowercase-key test.
- **No placeholders:** only the roster `*@confirm` email keys, explicitly non-blocking (degradation path tested).
- **External dependency:** apply migration to the DB (Task 9 Step 1) — Zach-gated with the prod ship; confirm roster emails (drop-in).
```
