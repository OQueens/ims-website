# Innovative Medical Staffing — Public Website Design Spec

**Status:** Phase 0 complete (live as of 2026-05-05T15:40:02Z); Phase 1+ outlined, refined after open-design prototyping
**Domain:** innovativemedicalstaffing.com (owned, blank slate, Namecheap DNS)
**Repo target:** `OQueens/ims-website`
**Created:** 2026-05-05

---

## 1. Goal

Public marketing website for Innovative Medical Staffing. Brand-grade, fast, accessible, conversion-aware. Two audiences: clinicians (supply) and hospitals/employers (demand).

## 2. Toolchain (locked)

- **Site framework:** Astro (SSG, zero JS by default, React/Svelte islands as needed)
- **Design generation:** [`nexu-io/open-design`](https://github.com/nexu-io/open-design) — local environment with 72 brand-grade design systems and 31 skills. We run it to generate prototype variants and pick a direction.
- **Design refinement:** [`pbakaus/impeccable`](https://github.com/pbakaus/impeccable) — installed as a Claude Code skill. Use `/impeccable critique`, `/polish`, `/audit`, `/harden` continuously through development. Run `npx impeccable detect` in CI as anti-AI-slop guardrail.
- **Token foundation:** Existing `IAS-Design-System.md` (Apple-HIG, light + dark, SF Pro, 4px grid, spring easing). Marketing scale typography is layered on top (display sizes 64-96px) — dashboard scale stays.
- **Hosting:** Cloudflare Pages (free, edge cache, SSL automatic)
- **DNS:** Namecheap (CNAME to Pages target, no nameserver migration today)
- **Forms backend:** Cloudflare Workers + Resend (email) + Supabase Storage (CV files) + Supabase row write
- **Analytics:** Plausible (privacy-friendly, GDPR-clean — matters for healthcare)
- **Search:** Pagefind (build-time static)
- **Content:** Astro Content Collections (MDX). Sanity considered if non-dev editing becomes a need.

## 3. Phase 0 — Live maintenance page (today, ~1 hour)

### Scope
Single page at `innovativemedicalstaffing.com` that signals "intentional, soon" without leaking that the site is greenfield.

### Page design (all decisions locked)
- Astro project initialized in `OQueens/ims-website`
- `src/pages/index.astro` — single page
- Dark mode default (`color-scheme: dark`); light mode mirrored via `prefers-color-scheme: light` for completeness
- IAS tokens loaded via `src/styles/tokens.css` (ported from `IAS-Design-System.md`)
- Centered viewport-height layout, no header/footer chrome
- **Wordmark:** "Innovative Medical Staffing" set in SF Pro Display, weight 600, letter-spacing tight, ~48-64px responsive
- **Sub-line:** "We're crafting something new. Back shortly." — body text, `var(--text-secondary)`, ~17px
- **No contact line** in v1 (no fake mailto). If you give me a real address before deploy, I'll add it as a soft link styled with `var(--accent)`.
- **No animation** beyond a 600ms fade-in on first paint (`--ease-out`). Calm = on-brand.
- **No logo art.** Typography carries the weight. Logo art added later when brand assets exist.

### SEO / crawler hygiene
- `<meta name="robots" content="noindex, nofollow">` on the page
- `/robots.txt` with `Disallow: /`
- No sitemap published yet
- HTTP 200 for v0 simplicity. (HTTP 503 + `Retry-After` is technically correct for "temporarily unavailable" but requires a Cloudflare Pages Function — defer to Phase 0.5 if it matters.)

### Repo hygiene
- `.gitignore` (Astro defaults + `.env`)
- `README.md` with two-line description and build commands
- `package.json` — Astro 5.x, no extra deps
- `astro.config.mjs` — minimal
- Commit the existing `IAS-Design-System.md` into the new repo as `docs/IAS-Design-System.md` (so the source of truth travels with the code)
- Commit this spec into the new repo as `docs/specs/2026-05-05-ims-website-design.md`
- `DEPLOY.md` at repo root with step-by-step Cloudflare Pages connect + Namecheap CNAME instructions for Zach

### Build/deploy steps (executed in this order)
1. Scaffold Astro project locally at `c:\Users\oclou\QueenClaude\ims-website\`
2. Implement maintenance page + tokens + robots.txt
3. Local build verification (`npm run build`, eyeball `dist/`)
4. `gh repo create OQueens/ims-website --public --source=. --remote=origin --push`
5. Hand off to Zach: Cloudflare Pages connect-repo flow + Namecheap CNAME instructions (documented in `DEPLOY.md` in the new repo)
6. Zach completes the OAuth + DNS steps (the only human-required steps — credentials)
7. Joint live verification on `https://innovativemedicalstaffing.com`

### Definition of done (Phase 0)
- `https://innovativemedicalstaffing.com` returns the maintenance page over HTTPS
- Lighthouse: 100 perf, 100 a11y, 100 best-practices, 100 SEO (achievable for a single static page)
- Page renders identically light/dark
- `robots.txt` confirmed live and disallowing all
- Spec + IAS Design System committed to repo

## 4. Phase 1+ — Real site (outline, refined post-Phase-0)

### Information architecture
```
/                                    Home (mission hero, dual CTA, specialty grid, social proof, trust bar)
/clinicians                          Why work with IMS
  /clinicians/specialties/[slug]     Programmatic specialty pages (SEO)
  /clinicians/submit-cv              Conversion event for supply side
  /clinicians/calculator             Locum income estimator (CompHealth-style trust device, defer to Phase 3)
/employers                           Why hire with IMS
  /employers/request-staff           Conversion event for demand side
  /employers/services                Sub-pages per service line (actual list deferred to §4 Open decisions)
/about                               Story, leadership, JC certification, values
/resources                           Hub: blog, guides, FAQs
  /resources/[slug]                  MDX-driven posts
/contact
robots.txt, sitemap.xml, /og/[*].png (programmatic OG images)
```

### Workflow for design generation
1. Install impeccable skill into the new repo's `.claude/skills/`
2. Run `/impeccable teach` — bootstraps `PRODUCT.md` and `DESIGN.md` from the IAS tokens
3. Run open-design locally, generate 3-4 homepage prototypes against different design systems (e.g., `editorial`, `apple`, `bento`, `corporate`)
4. Pick a direction (Zach's call — visual review)
5. Port the chosen direction into Astro components, keeping IAS tokens
6. `/impeccable shape`, `polish`, `critique`, `harden`, `delight` cycles
7. CI: `npx impeccable detect` blocks AI-slop merges

### Step breakdown within Phase 1+ (each ≈ 1 PR / 1 deploy)
- **Step A — Foundation:** layout primitives (Nav, Footer, Container, Section), typography + button + card components, dark mode wired
- **Step B — Home + clinician path E2E:** homepage, `/clinicians`, `/clinicians/submit-cv` form working end-to-end (Supabase Storage + Resend notification)
- **Step C — Employer path E2E:** `/employers`, `/employers/request-staff`
- **Step D — Specialty pages (programmatic) + `/about` + `/resources` shell**
- **Step E — Calculator + content seeding** (5-10 launch resources)
- **Step F — Polish pass:** `/impeccable polish` site-wide, Lighthouse 95+ floor, a11y audit, SEO meta + structured data + sitemap, OG images, then flip noindex off and ship

### Open decisions (deferred until post-Phase-0 briefing with Zach)
- Design direction (editorial-Apple recommended; alternatives: corporate, bento)
- Audience emphasis (equal-billing recommended; visual hierarchy slightly favors clinicians)
- Specialty list (need from Zach)
- ATS integration (Bullhorn / JobDiva / none — affects form backend wiring)
- Joint Commission certification status (affects trust devices)
- Brand voice / leadership bios / mission copy (need from Zach or drafted from competitor patterns + Zach review)
- Logo / wordmark art (currently typography-only)

## 5. Risks worth surfacing

- **PHI in CV uploads.** Some healthcare CVs include sensitive info. Encrypted-at-rest storage (Supabase ✓), retention policy, and BAA paperwork with anyone who touches the data. Phase 2 work.
- **Indexing accidents.** Maintenance page must stay noindex until the real site lands. Removing the meta + robots disallow is the deliberate launch ceremony.
- **Domain DNS state.** Currently pointed at Namecheap default DNS, no records configured. CNAME addition is the entire DNS work for Phase 0.
- **Brand voice gap.** I can draft v1 copy from competitor patterns + IMS positioning, but Zach owns final voice. Don't ship copy without his pass.
- **Compete on relationship vs scale.** AMN/CHG win on scale ("2M+ clinicians, 40 years"). IMS is smaller — differentiation lever is personal/specialized service. Tone and home hero should reflect that.

## 6. Out of scope (explicit non-goals)

- Live job board (no real-time job feed; defer until ATS integration is decided)
- Clinician portal / authenticated experience (this is the marketing site only; portal is a separate product)
- Internationalization (US-only for v1)
- A/B testing harness (Plausible goals are enough for v1; defer Optimize-style infra)
- Email marketing automation (Resend transactional only; Mailchimp/SendGrid/etc. deferred)

## 7. Success metric (forward-looking)

Phase 0: domain returns a clean maintenance page in under 1 hour from the moment Zach approves this spec.
Phase 1+: by launch, the site has a measurable conversion path from "/" → "submit-cv" or "/" → "request-staff" with form completion tracked in Plausible, and `npx impeccable detect` passes clean on every page.
