# Codex retroactive review of T1-T5 batch — findings 2026-05-06

**Job:** `task-moug6a8y-uuigw3` (4m 25s, completed)
**Commit range:** `b7e783d..743baac` (T1 + T2 + T3 + T4 + T5 + gitignore chore)
**Trigger:** Zach's question "why are we skipping codex" + review-gate hook fire after 11-file uncommitted threshold (10 of which were `.wrangler/` runtime cache, gitignored in `743baac`).
**Verdict:** **NO-GO** — Astro 6.2.2 + Cloudflare adapter v13.3.1 incompatibility with plan's design (Pages Functions middleware authority + plain `dist/` paths). Drove Path A decision (downgrade to Astro 5 + adapter v12).
**Codex session ID:** `019dfec0-cdff-7661-86db-f8cc8e35edca`
**Log:** `C:\Users\oclou\.claude\plugins\data\codex-inline\state\feat-ims-phase-1-plan-82fe483d25d1a912\jobs\task-moug6a8y-uuigw3.log`

## Findings

### NO-GO

**1. `scripts/verify-build.mjs:5-6` paths broken under adapter v13**
Checks `dist/index.html` + `dist/robots.txt`. Adapter v13 outputs static assets under `dist/client/` (with `dist/server/` for the Worker). `npm run verify` will fail today; T11 (voice-lint wire into verify) inherits the failure. **Fix:** path-resolve to `dist/client/` when present, or pin adapter to v12 to restore plain `dist/` output (Path A).

**2. `functions/_middleware.js:39` is dead code under adapter v13**
Phase 0 set this as the authoritative CSP/canonicalization layer. Adapter v13 generates a Cloudflare Worker (per `dist/server/wrangler.json` `"main":"entry.mjs"` + `"assets":{"binding":"ASSETS","directory":"../client"}`). Pages Functions middleware doesn't wrap Worker responses. **Plan T9 (CSP rewrite at this file) and T15 (remove `X-Robots-Tag` from this file) target a layer that won't run.** **Fix:** either (Path B) move security/canonical handling to `src/middleware.ts` (Astro middleware for SSR) + `public/_headers` (already auto-copied to `dist/client/_headers`, honored by Workers Static Assets), OR (Path A — selected) pin adapter to v12 to restore Pages Functions deployment model.

### AMBER

**3. `docs/plans/2026-05-06-ims-website-phase-1-plan.md:3014` — `Astro.locals.runtime.env` API gone in Astro 6**
Plan T35-T47 server libs reference `Astro.locals.runtime.env`. Astro 6 + Cloudflare adapter v13 throws on that — must use `import { env } from "cloudflare:workers"`. **Fix:** plan amendment to T35-T47, OR Path A downgrade where Astro 5 still supports the API.

**4. `astro.config.mjs:12` — `platformProxy: { enabled: true }` ignored by adapter v13.3.1**
Adapter v13.3.1 dropped this option from its types. Quietly does nothing; not breaking but stale. **Fix:** remove or replace with supported options (`persistState` / `remoteBindings`). Under Path A (adapter v12), the option is still valid.

### NIT

**5. `astro.config.mjs:19` — sitemap filter `page.includes('/jobs?')` false-positive risk**
Matches current intent but imprecise — could exclude unrelated future URLs containing `/jobs?` substring. **Fix:** parse `new URL(page)` and check `pathname === "/jobs"` && `search` non-empty:

```js
filter: (page) => {
  const url = new URL(page);
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/og/')) return false;
  if (url.pathname === '/jobs' && url.search) return false;
  return true;
},
```

## Confirmed clean

- `output: 'static'` is the correct Astro 6 replacement for removed `output: 'hybrid'`. `export const prerender = false` remains the right downstream SSR mechanism. (Note: under Path A pin to Astro 5, restore `output: 'hybrid'`.)
- T5 font paths resolve: TAY files exist under `public/fonts/`. `@import '@fontsource-variable/inter'` correctly placed at line 1 (CSS spec — `@import` must precede other rules).
- T4 brand palette tokens byte-exact to spec §4.1 with all 28 declarations inside `:root`. Existing dashboard tokens preserved.
- T3 vitest config minimal but right-shaped. Glob patterns cover planned `tests/`, `src/`, `workers/`. Cloudflare date-tagged versions (`workers-types@^4.20260506.1`, `miniflare@^4.20260504.0`) are normal release patterns, not pre-release pins.
- T2 dependency placement correct (in `dependencies`, not `devDependencies` — T5 references it from CSS at runtime).

## Path A remediation plan

Downgrade Astro to ^5 + Cloudflare adapter to ^12 to align runtime with plan design. Single fixup commit covers all NO-GO/AMBER/NIT findings:

1. `npm install astro@^5 @astrojs/cloudflare@^12` (RUN — completed 2026-05-06; package.json/lock uncommitted)
2. Revert `astro.config.mjs:10`: `output: 'static'` → `output: 'hybrid'`
3. Verify `astro.config.mjs:12` `platformProxy` behavior under adapter v12 — likely keep
4. Tighten sitemap filter per the URL-parsing replacement above
5. `npm run build` — verify dist/ structure matches plan-expected layout (top-level `dist/index.html`, no `dist/client/` split)
6. `npm run verify` — verify-build.mjs paths align with adapter v12 output
7. Single fixup commit: `[runtime-verified] [codex-reviewed: T1-T5 batch r1 NO-GO 2 + AMBER 2 + NIT 1 → fold]`
8. Re-run Codex on T1-T5 + fixup batch via direct Bash invocation (Skill wrapper hook-blocked)
9. Once Codex GO → stamp review-gate: `bash ~/.claude/hooks/review-gate.sh --stamp`

## Why downgrade beats Path B (migration to v6 + Workers)

Adapter v13's wrangler.json output expects **Cloudflare Workers** deployment (not Cloudflare Pages auto-deploy from git). Migrating Pages → Workers means dashboard reconfiguration, DNS routing changes, new CI flow. Under 1-week LS authorization deadline, that's deployment risk.

Path A preserves Pages deploy + makes plan T9/T15/T35-T47 work as written. v6 + Workers + Astro middleware migration becomes a clean Phase 1.5 effort with proper planning.

## Lesson

Per-task code-reviewer subagents only see their own diff in isolation. A retrospective Codex pass against the live filesystem caught architectural mismatches (plan-vs-runtime version drift) the per-task reviews structurally couldn't. **For foundation-tier batches (Wave 1-style infrastructure), run Codex on the cumulative batch even when each task individually qualifies for `[codex-skip]`.** The matrix's per-task classification is necessary but not sufficient.
