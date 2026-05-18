# IMS Step 1 — Backend Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate Phase 1.A's tested LocumSmart→Supabase backbone into the Belleval codebase so `/jobs` server-renders real `ims_jobs` data through the public-only privacy contract, without changing Belleval's 8 prerendered pages or its zero-JS design.

**Architecture:** Adopt the Astro `@astrojs/cloudflare` adapter (`output:'static'` + per-route `prerender=false`). The webhook receiver + pure logic + migrations move verbatim. A new single-source read helper (`src/lib/ims-jobs-read.ts`) owns the deny-by-default public column allowlist; the reskinned `/jobs` page consumes only that. No client JS is added (CSP/zero-JS preserved); the Phase 1.A client filter rail is explicitly deferred to program Step 2.

**Tech Stack:** Astro 6, `@astrojs/cloudflare`, `@supabase/supabase-js`, Cloudflare Pages (Functions + adapter Worker coexisting), vitest, TypeScript (astro strict).

**Spec:** `docs/superpowers/specs/2026-05-18-ims-backend-consolidation-design.md` (committed `b50e399`).

**Source worktree for verbatim relocations:** `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan` (Phase 1.A, branch `feat/ims-phase-1a-content`, read/extract only — never modified).

**Target worktree (all writes):** `C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site` (branch `feat/ims-temp-site`, HEAD `667bbaa`).

**Standing constraints:** No push (going live is a separate explicit gate). No commit without the work being green. Codex peer-review the security-sensitive code (receiver + read helper + privacy render) — **3 rounds**, per the collaboration mandate. Tag every completion claim (`[runtime-verified]` / `[logically-inspected]` / `[syntax-checked]`).

---

## File Structure

| Path (in target worktree) | Action | Responsibility |
|---|---|---|
| `package.json` | Modify | add adapter + supabase-js deps, vitest devdeps, `test` script |
| `astro.config.mjs` | Rewrite | `output:'static'` + `adapter: cloudflare()` + `site` |
| `vitest.config.ts` | Create | node env, `src/**/*.test.ts` |
| `src/lib/locumsmart-webhook-logic.ts` | Create (verbatim copy) | pure LS payload→row mapping, auth, freshness, redaction |
| `src/lib/locumsmart-webhook-logic.test.ts` | Create (verbatim copy) | the proven unit suite for the above |
| `src/pages/api/locumsmart-webhook.ts` | Create (verbatim copy) | LS webhook receiver endpoint (`prerender=false`) |
| `migrations/20260508_ims_jobs_table.sql` | Create (verbatim copy) | `ims_jobs` schema of record |
| `migrations/20260506_ims_phase1_tables.sql` | Create (verbatim copy) | `ims_applications`/`ims_contact_messages` schema of record |
| `src/lib/ims-jobs-read.ts` | Create (new) | **single source of the public-only column allowlist** + `JobRow` type + view helpers + `fetchActiveJobs(env)` |
| `src/lib/ims-jobs-read.test.ts` | Create (new) | privacy assertion: allowlist excludes every internal column; view helpers cannot emit internal data |
| `src/pages/jobs.astro` | Rewrite | Belleval-design SSR list from `fetchActiveJobs`; dignified empty state; **no client JS** |

**Out of scope (do NOT touch):** the 8 prerendered pages' content, `functions/api/contact.js`, `functions/_middleware.js`, `public/_headers`, `src/styles/ims.css`, every other component. Filter rail / search UX, homepage live-data wiring, real-team content, the em-dash/members-club/a11y fix campaign, `impeccable live` — all are later program steps.

---

## Task 1: Dependencies, adapter config, test infra

**Files:**
- Modify: `package.json`
- Rewrite: `astro.config.mjs`
- Create: `vitest.config.ts`

- [ ] **Step 1: Determine the `@astrojs/cloudflare` version compatible with Astro 6**

Belleval is Astro `^6.2.2`. Phase 1.A used `@astrojs/cloudflare@^12.6.13` on Astro 5 — do NOT assume that version fits Astro 6.

Run (resolve the version actually installable against Astro 6):
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npm view @astrojs/cloudflare peerDependencies --json
npm view @astrojs/cloudflare versions --json | tail -5
```
Then confirm the Astro-6 adapter config shape via context7 (`mcp__plugin_context7_context7__resolve-library-id` "astro" then query-docs for "@astrojs/cloudflare adapter Astro 6 output static prerender false"). Record the chosen `@astrojs/cloudflare` version in the commit message.
Expected: a major of `@astrojs/cloudflare` whose `peerDependencies.astro` satisfies `^6`. Use that exact major (`@astrojs/cloudflare@^<major>`), not `^12.6.13`.

- [ ] **Step 2: Add dependencies**

Run (replace `<CF_ADAPTER>` with the version resolved in Step 1):
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npm install @astrojs/cloudflare@<CF_ADAPTER> @supabase/supabase-js@^2.105.4
npm install -D vitest@^4.1.5 @cloudflare/workers-types@^4.20260506.1
```
Expected: installs succeed; `package.json` `dependencies` gains `@astrojs/cloudflare` + `@supabase/supabase-js`; `devDependencies` gains `vitest` + `@cloudflare/workers-types`. No peer-dep ERESOLVE against `astro@^6`.

- [ ] **Step 3: Add the `test` script to `package.json`**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Rewrite `astro.config.mjs`**

Replace the entire file with (adjust ONLY if Step 1's context7 check shows a different Astro-6 adapter config shape — if so, follow the official Astro 6 docs and note the deviation):
```js
// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

const SITE_URL = 'https://innovativemedicalstaffing.com';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  adapter: cloudflare(),
});
```

- [ ] **Step 5: Create `vitest.config.ts`**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
    testTimeout: 10000,
  },
});
```

- [ ] **Step 6: Verify the build still produces the 8 static pages**

Run:
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx astro build 2>&1 | tail -20
```
Expected: build green; the existing 8 routes still generate (`/`, `/clinicians`, `/contact`, `/couldnt-send`, `/facilities`, `/jobs`, `/story`, `/thank-you`). The adapter being present must NOT break the static pages (they have no `prerender=false` yet). If the build fails on adapter config, fix per the Astro 6 docs from Step 1 before proceeding. **[runtime-verified]** required.

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git add package.json package-lock.json astro.config.mjs vitest.config.ts
git -c commit.gpgsign=false commit -m "chore(belleval): add cloudflare adapter + supabase-js + vitest infra

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Relocate the pure webhook logic + its proven test suite

**Files:**
- Create: `src/lib/locumsmart-webhook-logic.ts` (verbatim copy)
- Create: `src/lib/locumsmart-webhook-logic.test.ts` (verbatim copy)
- Test: the copied `src/lib/locumsmart-webhook-logic.test.ts`

This file is pure TypeScript (no Astro/Cloudflare imports) and is the unit-tested spec for auth, field mapping, freshness, and secret redaction. It ports **verbatim** — the source is the authority; do not edit on copy.

- [ ] **Step 1: Copy the logic + test verbatim from the Phase 1.A worktree**

Run:
```bash
mkdir -p "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site/src/lib"
cp "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/locumsmart-webhook-logic.ts" \
   "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site/src/lib/locumsmart-webhook-logic.ts"
cp "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/src/lib/locumsmart-webhook-logic.test.ts" \
   "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site/src/lib/locumsmart-webhook-logic.test.ts"
```
Expected: both files exist in the target `src/lib/`. Do not modify their contents.

- [ ] **Step 2: Run the ported suite to verify it passes unchanged**

Run:
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx vitest run src/lib/locumsmart-webhook-logic.test.ts
```
Expected: all tests PASS (same count as Phase 1.A). This proves the pure logic survived relocation. If any fail, the copy was altered or a Node/TS version differs — diff against the source and fix the copy (never the logic) until green. **[runtime-verified]** required.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git add src/lib/locumsmart-webhook-logic.ts src/lib/locumsmart-webhook-logic.test.ts
git -c commit.gpgsign=false commit -m "feat(belleval): relocate LS webhook pure logic + tests (verbatim from Phase 1.A)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Relocate the webhook endpoint + migrations of record

**Files:**
- Create: `src/pages/api/locumsmart-webhook.ts` (verbatim copy)
- Create: `migrations/20260508_ims_jobs_table.sql` (verbatim copy)
- Create: `migrations/20260506_ims_phase1_tables.sql` (verbatim copy)

The endpoint uses only stable Astro APIs (`import type { APIRoute } from 'astro'`, `export const prerender = false`, `Astro.locals.runtime.env` cast) — Astro 5/6 stable. Ports verbatim.

- [ ] **Step 1: Copy the endpoint + both migrations verbatim**

Run:
```bash
mkdir -p "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site/src/pages/api"
mkdir -p "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site/migrations"
cp "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/src/pages/api/locumsmart-webhook.ts" \
   "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site/src/pages/api/locumsmart-webhook.ts"
cp "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/migrations/20260508_ims_jobs_table.sql" \
   "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site/migrations/20260508_ims_jobs_table.sql"
cp "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-phase-1-plan/migrations/20260506_ims_phase1_tables.sql" \
   "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site/migrations/20260506_ims_phase1_tables.sql"
```
Expected: all three files present at the target paths.

- [ ] **Step 2: Type-check the endpoint compiles under Astro 6 strict**

Run:
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx astro build 2>&1 | tail -25
```
Expected: build green; `/api/locumsmart-webhook` is emitted as an on-demand (Worker) route, NOT prerendered. Confirm in build output that 8 static pages still generate AND `dist/_routes.json` (or build log) shows the API route is dynamic. If `astro check`/TS errors appear (e.g. `App.Locals` runtime typing), the endpoint already self-casts `Astro.locals as { runtime?: { env?: PagesEnv } }` so no global augmentation is needed — fix only genuine Astro-6 type drift, never the auth/upsert logic. **[runtime-verified]** required.

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git add src/pages/api/locumsmart-webhook.ts migrations/
git -c commit.gpgsign=false commit -m "feat(belleval): relocate LS webhook endpoint + migrations of record

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Privacy-safe read helper (TDD) — the single source of the public allowlist

**Files:**
- Create: `src/lib/ims-jobs-read.ts`
- Test: `src/lib/ims-jobs-read.test.ts`

This is the security keystone. The Supabase `.select()` allowlist lives here and ONLY here; `JobRow` carries only public fields; the view helpers can only reference `JobRow`. Internal columns (`facility_name`, `facility_names`, `description`, `raw_payload`, `organization`, `organization_id`) are named in `INTERNAL_JOB_COLUMNS` solely so the test can assert they never appear in the allowlist.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ims-jobs-read.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  PUBLIC_JOB_COLUMNS,
  INTERNAL_JOB_COLUMNS,
  specialtyLabel,
  facilityHeadline,
  bodyParts,
  cardTitle,
  type JobRow,
} from './ims-jobs-read';

describe('privacy contract', () => {
  it('public allowlist contains no internal column', () => {
    const cols = PUBLIC_JOB_COLUMNS.split(',').map((c) => c.trim());
    for (const internal of INTERNAL_JOB_COLUMNS) {
      expect(cols).not.toContain(internal);
    }
  });

  it('allowlist is exactly the agreed public set', () => {
    expect(PUBLIC_JOB_COLUMNS.split(',').map((c) => c.trim()).sort()).toEqual(
      [
        'id', 'specialty_slug', 'specialty_name', 'facility_state',
        'facility_city', 'public_facility_label', 'length_category',
        'call_type', 'coverage_type',
      ].sort(),
    );
  });

  it('view helpers never surface an internal facility name', () => {
    const row: JobRow = {
      id: 'a1', specialty_slug: 'crna', specialty_name: 'CRNA',
      facility_state: 'OH', facility_city: 'Cincinnati',
      public_facility_label: 'Level 1 Trauma Center',
      length_category: 'medium', call_type: 'No call', coverage_type: 'Vacation',
    };
    const rendered = [
      facilityHeadline(row), bodyParts(row), cardTitle(row),
      specialtyLabel(row.specialty_slug),
    ].join(' | ');
    expect(rendered).toContain('Level 1 Trauma Center');
    expect(rendered).not.toMatch(/Mercy|Hospital A|555-|raw_payload/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx vitest run src/lib/ims-jobs-read.test.ts
```
Expected: FAIL — `Cannot find module './ims-jobs-read'`.

- [ ] **Step 3: Implement `src/lib/ims-jobs-read.ts`**

Create `src/lib/ims-jobs-read.ts` (view helpers ported verbatim from the canonical Phase 1.A `/jobs` page so behaviour is identical; the allowlist + types are the privacy keystone):
```ts
/**
 * Single source of the ims_jobs PUBLIC read contract.
 *
 * The schema (migrations/20260508_ims_jobs_table.sql) deliberately separates
 * INTERNAL columns (facility_name, facility_names, description, raw_payload,
 * organization, organization_id — LS payloads embed facility identity, phone
 * numbers, and "vendors must NOT contact the facility" disclaimers) from
 * PUBLIC columns. NOTHING outside this module may query ims_jobs; every
 * public read goes through fetchActiveJobs so the allowlist is the only
 * column set that can reach a rendered page. Deny-by-default: a column not
 * in PUBLIC_JOB_COLUMNS cannot be selected here.
 */
import { createClient } from '@supabase/supabase-js';

export const PUBLIC_JOB_COLUMNS =
  'id, specialty_slug, specialty_name, facility_state, facility_city, public_facility_label, length_category, call_type, coverage_type';

/** Named ONLY so the privacy test can assert they never enter the allowlist. */
export const INTERNAL_JOB_COLUMNS = [
  'facility_name', 'facility_names', 'description', 'raw_payload',
  'organization', 'organization_id',
] as const;

export interface JobRow {
  id: string;
  specialty_slug: string;
  specialty_name: string | null;
  facility_state: string | null;
  facility_city: string | null;
  public_facility_label: string | null;
  length_category: string | null;
  call_type: string | null;
  coverage_type: string | null;
}

export interface JobsEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export const specialtyLabel = (s: string): string =>
  s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const lengthDisplay = (c: string | null): string =>
  c ? c.charAt(0).toUpperCase() + c.slice(1) : '';

export const facilityHeadline = (j: JobRow): string => {
  // Always render public_facility_label; facility_name_public clearance is
  // intentionally NOT consulted (sticky-clearance hazard documented in the
  // schema). 'Healthcare Facility' only fires for the admin-set-NULL edge.
  const label = j.public_facility_label ?? 'Healthcare Facility';
  const locTail = [j.facility_city, j.facility_state].filter(Boolean).join(', ');
  return locTail ? `${label} · ${locTail}` : label;
};

export const bodyParts = (j: JobRow): string =>
  [j.call_type, j.coverage_type].filter(Boolean).join(' · ');

export const cardTitle = (j: JobRow): string =>
  j.specialty_name ?? specialtyLabel(j.specialty_slug);

/**
 * Read active public job rows. Returns [] on any misconfig/error so the page
 * renders the dignified empty state rather than throwing. LIMIT 1000 matches
 * the PostgREST default server max (Phase 1.A scale is tens-to-low-hundreds
 * of active rows); range pagination is a later step if scale exceeds it.
 */
export async function fetchActiveJobs(env: JobsEnv): Promise<JobRow[]> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[/jobs] env not configured — rendering empty state');
    return [];
  }
  try {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from('ims_jobs')
      .select(PUBLIC_JOB_COLUMNS)
      .eq('status', 'active')
      .order('ls_last_modified', { ascending: false, nullsFirst: false })
      .limit(1000);
    if (error) {
      console.error('[/jobs] supabase read failed:', error.message);
      return [];
    }
    return (data as JobRow[] | null) ?? [];
  } catch (e) {
    console.error('[/jobs] supabase client crash:', e);
    return [];
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx vitest run src/lib/ims-jobs-read.test.ts
```
Expected: all 3 tests PASS. **[runtime-verified]** required.

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git add src/lib/ims-jobs-read.ts src/lib/ims-jobs-read.test.ts
git -c commit.gpgsign=false commit -m "feat(belleval): ims_jobs public-only read helper + privacy assertion test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Reskin `/jobs` as a Belleval SSR list (no client JS)

**Files:**
- Rewrite: `src/pages/jobs.astro`

Replace the `<Placeholder route="/jobs" />` stub with a server-rendered list using `fetchActiveJobs`, in Belleval's design system (`IMSLayout`, `Eyebrow`, `Button`, `Icon`, `ims.css` tokens), matching the `Placeholder.astro` composition idiom. **No `<script>`** (zero-JS/CSP). The Phase 1.A filter rail + client filtering are NOT ported (program Step 2).

- [ ] **Step 1: Rewrite `src/pages/jobs.astro`**

Replace the entire file with:
```astro
---
/**
 * /jobs — open opportunities, server-rendered from Supabase ims_jobs.
 *
 * prerender=false: LS webhook events surface without a rebuild. Reads ONLY
 * through fetchActiveJobs (public column allowlist). NO client JS — the site
 * is zero-JS by CSP design; filter/search UX is program Step 2.
 *
 * Privacy: facility_name / description / raw_payload are INTERNAL and are
 * never selected (see src/lib/ims-jobs-read.ts). Headline is the derived
 * public_facility_label only.
 */
import IMSLayout from "../layouts/IMSLayout.astro";
import Eyebrow from "../components/Eyebrow.astro";
import Button from "../components/Button.astro";
import Icon from "../components/Icon.astro";
import {
  fetchActiveJobs,
  specialtyLabel,
  lengthDisplay,
  facilityHeadline,
  bodyParts,
  cardTitle,
  type JobsEnv,
} from "../lib/ims-jobs-read";

export const prerender = false;

const cfEnv = (Astro.locals as { runtime?: { env?: JobsEnv } }).runtime?.env;
const env: JobsEnv = cfEnv ?? {
  SUPABASE_URL: import.meta.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
};

const jobs = await fetchActiveJobs(env);
const total = jobs.length;
---
<IMSLayout title="Job board — Innovative Medical Staffing" route="/jobs">
  <section class="jobs section section--lg">
    <header class="jobs__head">
      <Eyebrow orn={false} tone="gold">Job board</Eyebrow>
      <h1>{total > 0 ? "Open opportunities." : "Roles open soon."}</h1>
      <p class="lede">
        {total > 0
          ? `${total} active ${total === 1 ? "assignment" : "assignments"} across the IMS network. Every listing has a recruiter attached; nothing is auto-scraped.`
          : "No live assignments at this moment. Tell us what you're looking for and a real recruiter will reach out the day one opens."}
      </p>
    </header>

    {total > 0 ? (
      <div class="jobs__grid">
        {jobs.map((j) => (
          <article class="jc">
            <div class="jc__eb">
              <span class="jc__spec">{specialtyLabel(j.specialty_slug)}</span>
              {j.length_category && <span class="jc__len">{lengthDisplay(j.length_category)}</span>}
            </div>
            <h2 class="jc__h">{facilityHeadline(j)}</h2>
            {bodyParts(j) && <p class="jc__b">{bodyParts(j)}</p>}
            <p class="jc__rate"><em>Rate on request</em></p>
            <Button href="/contact" variant="ghost">
              Apply through IMS <Icon name="arrowRight" size={14} color="var(--ink)" />
            </Button>
          </article>
        ))}
      </div>
    ) : (
      <aside class="jobs__empty">
        <Eyebrow orn={false} tone="gold">No listings yet</Eyebrow>
        <h2>Tell us what you're after.</h2>
        <p>We place across every specialty. Send one note and the right recruiter follows up the moment a match opens.</p>
        <div class="cta">
          <Button href="/contact" variant="primary">Get in touch <Icon name="arrowRight" size={14} color="var(--on-pine)" /></Button>
          <Button href="/" variant="ghost"><Icon name="arrowLeft" size={14} color="var(--ink)" /> Back to home</Button>
        </div>
      </aside>
    )}
  </section>
</IMSLayout>

<style>
  .jobs__head { max-width: 60ch; }
  .jobs__head h1 { font: var(--t-display-lg); letter-spacing: var(--tracking-display); color: var(--ink); margin-top: 16px; }
  .jobs__head .lede { font: var(--t-body-lg); color: var(--ink-2); margin-top: 20px; max-width: 52ch; }
  .jobs__grid {
    margin-top: 56px; display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px;
  }
  .jc {
    border: 1px solid var(--line); border-radius: var(--r-xl);
    padding: 32px; background: var(--paper);
    display: flex; flex-direction: column; gap: 12px;
  }
  .jc__eb {
    font: var(--t-label); letter-spacing: .14em; text-transform: uppercase;
    display: flex; gap: 14px; align-items: baseline;
  }
  .jc__spec { color: var(--ims-blue-ink); }
  .jc__len { color: var(--ink-3); }
  .jc__h { font: var(--t-h3); color: var(--ink); line-height: 1.3; }
  .jc__b { font: 500 15px/1.5 var(--sans); color: var(--ink-2); }
  .jc__rate { font: 600 14px/1.4 var(--sans); color: var(--ink-2); margin-top: auto; }
  .jobs__empty {
    margin-top: 48px; background: var(--paper); border: 1px solid var(--line);
    border-radius: var(--r-xl); padding: 56px; max-width: 60ch;
  }
  .jobs__empty h2 { font: var(--t-display-lg); letter-spacing: var(--tracking-display); color: var(--ink); margin-top: 14px; }
  .jobs__empty p { font: var(--t-body-lg); color: var(--ink-2); margin-top: 16px; max-width: 46ch; }
  .jobs__empty .cta { display: flex; gap: 12px; margin-top: 28px; flex-wrap: wrap; }
  @media (max-width: 900px) { .jobs__grid { grid-template-columns: 1fr; } .jobs__empty { padding: 36px; } }
</style>
```

- [ ] **Step 2: Verify the build emits `/jobs` as a server route + 7 static pages**

Run:
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx astro build 2>&1 | tail -25
```
Expected: build green. `/jobs` is NO LONGER in the prerendered static page list (it is now on-demand); the other 7 pages (`/`, `/clinicians`, `/contact`, `/couldnt-send`, `/facilities`, `/story`, `/thank-you`) still prerender. Confirm `dist/_routes.json` includes the dynamic `/jobs` + `/api/locumsmart-webhook` and excludes the 7 static pages. **[runtime-verified]** required.

- [ ] **Step 3: Verify zero client JS was introduced**

Run:
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
grep -rn "<script" src/pages/jobs.astro || echo "OK: no script tag in jobs.astro"
```
Expected: `OK: no script tag in jobs.astro`. (The CSP in `public/_headers` / `functions/_middleware.js` has no `script-src`; introducing client JS would break the page — this guard prevents regressing the zero-JS design.)

- [ ] **Step 4: Commit**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git add src/pages/jobs.astro
git -c commit.gpgsign=false commit -m "feat(belleval): SSR /jobs from ims_jobs in Belleval design (zero-JS, public-only)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Runtime verification + Codex security review

**Files:** none changed (verification + review only).

- [ ] **Step 1: Build + preview, curl the empty-state path**

The LS "Website" subscription / Supabase env may not be wired (Task 7) — without env, `/jobs` must render the dignified empty state, not error.

Run:
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx astro build >/dev/null 2>&1 && (npx astro preview --port 4319 &) && sleep 6
curl -s -o /dev/null -w "jobs:%{http_code}\n" --max-time 8 http://localhost:4319/jobs
curl -s --max-time 8 http://localhost:4319/jobs | grep -o "Roles open soon\|Open opportunities" | head -1
curl -s -o /dev/null -w "contact:%{http_code}\n" --max-time 8 http://localhost:4319/contact
```
Expected: `jobs:200`; the grep prints `Roles open soon` (no env → empty state) OR `Open opportunities` (env wired + rows); `contact:200` (the existing Resend Pages Function is NOT regressed by the adapter addition). **[runtime-verified]** required. Kill the preview per the server-gotcha method afterward; clean any `.playwright-mcp`/screenshot artifacts from the paused worktree.

- [ ] **Step 2: Verify the webhook endpoint rejects/accepts correctly (local)**

Run (no env set locally → expect 500 misconfig, which is the intended LS-retry-friendly behaviour):
```bash
curl -s -o /dev/null -w "nopayload:%{http_code}\n" -X POST --max-time 8 http://localhost:4319/api/locumsmart-webhook -H "Content-Type: application/json" -d '{}'
curl -s -o /dev/null -w "getmethod:%{http_code}\n" --max-time 8 http://localhost:4319/api/locumsmart-webhook
```
Expected: `nopayload:500` (env unset → "Server misconfigured", intentional so LS retries heal post-deploy) or `400` if env happens to be set; `getmethod:405` (GET not allowed). Document which. **[runtime-verified]** required.

- [ ] **Step 3: Codex security review — Round 1 (mandate: 3 rounds, security-sensitive)**

Hand the diff of `src/lib/ims-jobs-read.ts`, `src/pages/jobs.astro`, `src/pages/api/locumsmart-webhook.ts`, and `astro.config.mjs` to Codex (`/codex:rescue` or the codex runtime). Prompt focus: (a) can ANY internal column (`facility_name`/`description`/`raw_payload`) reach rendered HTML via any path; (b) is `prerender=false` correctly applied so secrets never enter a prerendered/static artifact; (c) adapter/Pages-Function routing — does `/api/contact` still resolve to the Function and `/api/locumsmart-webhook` to the Astro Worker; (d) does the empty-state/`[]`-on-error path leak nothing. Fold all findings.

- [ ] **Step 4: Codex Round 2 — re-review after Round 1 fixes**

Re-hand the updated diff. Expected: Round 1 findings resolved, no new criticals.

- [ ] **Step 5: Codex Round 3 — final pass**

Re-hand. Expected: Codex has nothing material to add. If Round 3 still surfaces a critical, loop until clean (the mandate is "loop until Codex has nothing to add" for security-sensitive code).

- [ ] **Step 6: Commit any Codex-fold changes**

```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
git add -A
git -c commit.gpgsign=false commit -m "fix(belleval): fold Codex r1-r3 review of LS backend consolidation

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
(Skip the commit if Codex folded nothing — note "[codex: clean, no folds]".)

---

## Task 7: Wiring verification + Zach handoff checklist

**Files:** none changed (operational verification only).

- [ ] **Step 1: Determine the actual Supabase + LS wiring state**

Check (do not print secret values — only presence):
```bash
cd "C:/Users/oclou/QueenClaude/ias-website/.worktrees/feat-ims-temp-site"
npx wrangler pages project list 2>&1 | head -20 || echo "wrangler not authed — Zach must check the Cloudflare dashboard"
```
Determine: (a) does the `ims-website` Cloudflare Pages project have `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LOCUMSMART_WEBHOOK_SECRET` set (Production + Preview); (b) does a LocumSmart **"Website"** subscription exist with **NO specialty parameter filter (every specialty)** pointing at the deployed `/api/locumsmart-webhook` URL. If `wrangler` is not authed, this becomes a Zach checklist item (Step 2) — do not block the build on it.

- [ ] **Step 2: Produce the Zach operational checklist**

Write the findings + the exact remaining actions for Zach into `docs/superpowers/plans/2026-05-18-ims-step1-WIRING-CHECKLIST.md`: which env vars are set vs missing; whether the unfiltered "Website" LS subscription exists; the precise LocumSmart dashboard steps (Administration → Integration → create "Website" subscription, no specialty parameter, webhook URL = `https://innovativemedicalstaffing.com/api/locumsmart-webhook`, copy its Webhook Key into the Pages env `LOCUMSMART_WEBHOOK_SECRET`). Commit that doc.

- [ ] **Step 3: Definition-of-Done verification**

Confirm and record (tagged): adapter+deps added & build green with 7 static + SSR `/jobs`+webhook; ported `locumsmart-webhook-logic.test.ts` passes; `ims-jobs-read.test.ts` privacy assertions pass; `/jobs` renders empty-state correctly with no env and (if wired) live rows with only public fields; `/api/contact` non-regressed; zero client JS in `jobs.astro`; Codex 3 rounds folded; nothing from program Steps 2–6 implemented; nothing pushed.

- [ ] **Step 4: Update project memory + report**

Update the authoritative memory block: Step 1 status, new HEAD, wiring state, what Zach still owns. Report to Zach: Step 1 done + verified (tagged), the wiring checklist, and that the next program step (Step 2 — data wiring) is a fresh spec/plan cycle. **Do not push.**

---

## Self-Review (against the spec)

**Spec coverage:**
- Spec §3 in-scope (adapter+supabase-js, config, relocate 5 files, read helper+contract, SSR `/jobs`, ported tests, privacy test, wiring verify) → Tasks 1–7. ✓
- Spec §4 runtime decision (Astro adapter) → Task 1 (with Astro-6 version verification, addressing the §5/§9 Astro 5→6 drift risk). ✓
- Spec §6 privacy contract (top risk) → Task 4 (single-source allowlist + deny-by-default + assertion test) + Task 6 Step 3 (3-round Codex). ✓
- Spec §7 SSR/static matrix → Task 5 Step 2 verifies 7 static + `/jobs` dynamic. ✓
- Spec §8 LS unfiltered "Website" subscription → Task 7 Steps 1–2. ✓
- Spec §10 testing (ported suite, privacy assertion, build+runtime curl, contact non-regression, 3-round Codex) → Tasks 2,4,5,6. ✓
- Spec §3 out-of-scope (contact left as-is; filter rail/homepage/real-team/fix-campaign/impeccable-live excluded) → File Structure "Out of scope" + Task 5 explicitly drops the client filter rail. ✓
- Spec §11 Zach operational deps → Task 7 Step 2 checklist. ✓

**Placeholder scan:** No "TBD/handle errors/similar to". Verbatim relocations are exact `cp` commands with full source paths (deterministic, not vague). New files contain complete literal code. The one variable (`<CF_ADAPTER>` / `<major>`) is explicitly resolved by Task 1 Step 1 before use — not a placeholder, a computed input. ✓

**Type consistency:** `JobRow`, `JobsEnv`, `PUBLIC_JOB_COLUMNS`, `INTERNAL_JOB_COLUMNS`, `fetchActiveJobs`, `specialtyLabel`, `lengthDisplay`, `facilityHeadline`, `bodyParts`, `cardTitle` are defined in Task 4 and consumed with identical signatures in Tasks 4 (test) and 5 (`jobs.astro`). The `Astro.locals` runtime cast shape matches between the relocated webhook endpoint and the new `jobs.astro`. ✓

**Risk handling:** privacy = single-source allowlist + deny-by-default + assertion test + 3-round Codex; Astro 5→6 drift = explicit version-resolution + build gates; LS wiring unknown = verification task + empty-state acceptable; routing coexistence = curl both endpoints. ✓

No gaps found.
