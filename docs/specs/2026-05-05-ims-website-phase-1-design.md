# IMS Website — Phase 1 Design Spec

**Status:** Brainstorm complete; spec awaiting Zach review before plan-writing
**Branch target:** `main` (currently `519bf1a`)
**Predecessor spec:** [`2026-05-05-ims-website-design.md`](./2026-05-05-ims-website-design.md) (Phase 0 maintenance page — LIVE)
**Created:** 2026-05-06
**Brand brief load-bearing:** captured verbatim in [Phase 1 brainstorm pause memo](file:///C:/Users/oclou/.claude/projects/c--Users-oclou-QueenClaude/memory/projects/project_ims_website_phase1_BRAINSTORM_PAUSED_section1_of_5_2026-05-05.md)

---

## 0. Executive summary

Phase 1 builds the public marketing site on top of the existing Astro Phase-0 scaffold. Visual language: **purposetalent.xyz aesthetic** (dark exterior chrome + warm cream rounded card + display sans + hand-drawn illustrated character). Typography: **TAY Basal** (display) + **TAY Amaya** (body), self-hosted from Zach's Typeface Collection. Job board: ships as a manual Astro Content Collection by default (Path B); upgrades to a Cloudflare Scheduled Worker pulling LocumSmart into KV (Path A) if LS admin authorization lands by 2026-05-13. Apply flow at launch: lightweight contact form (no CV upload), recruiter-followup-by-email; CV upload + Supabase Storage ship in Phase 1.5. Launch gate: the technical + process checklist in §5 Phase 1.A passes, including X-Robots-Tag removal from `functions/_middleware.js:20` and `public/_headers:2`, the new CSP block in §0.5.3, and DNSSEC DS record at Namecheap.

Brand brief stays load-bearing for messaging, voice, copy, and editorial rules. The visual translation moves from the originally-presented "boutique editorial Apple-Garamond" direction to PT-aesthetic per Zach's 2026-05-06 redirection.

---

## 0.5 Technical decisions (locked)

These resolve Codex round 1 NO-GO findings. Plan-writing depends on these being decided.

### 0.5.1 Astro runtime + adapter

- **Adapter:** `@astrojs/cloudflare` (latest, Cloudflare Pages target).
- **Mode:** `output: "hybrid"`. Marketing pages prerender at build time (SSG). On **Path A** (LS Worker + KV): `/jobs`, `/jobs/[id]` (Phase 1.5), and `/api/*` opt into SSR via `export const prerender = false` so they can read KV at request time. On **Path B** (default planning baseline; manual Content Collection): `/jobs` is SSG (rebuilt on every Content Collection change), `/api/apply` and `/api/contact` still opt into SSR (they need server runtime regardless). `/api/jobs` does not exist on Path B. This keeps Lighthouse perf hot on marketing routes either way.
- **Local dev:** `astro dev` for marketing pages. Wrangler-driven local for KV-bound routes via `npx wrangler pages dev dist --kv RATE_KV --kv JOBS_KV` after a build (Path A). For Path B-only deploys, drop `--kv JOBS_KV`. CI verifies build via existing `npm run verify`.
- **Sitemap:** `@astrojs/sitemap` integration installed. Canonical site URL `https://innovativemedicalstaffing.com`. Excludes `/api/*`, `/og/*`, and ALL `/jobs?...` filtered URLs. Includes `/jobs`, `/jobs/[id]` (after Phase 1.5), `/specialties/[slug]` (after Phase 1.75), `/privacy`, `/cookies`, `/terms`. (Legal pages are flat at root per §0.5.7, so the earlier-draft `/legal/*` exclude pattern is dropped.)
- **MDX:** **NOT in Phase 1.** Resources/blog (where MDX would land) is Phase 1.9. Voice-lint glob is `.astro` + `.md` only.

### 0.5.2 LocumSmart cron mechanism

Cloudflare Pages Functions do NOT have native cron triggers. Decision:

- **Path A (scope-add if LS auth lands): Scheduled Worker** — separate Worker at `workers/jobs-sync/` with `[triggers] crons = ["0 * * * *"]` in `wrangler.toml` (top of every hour). Free tier covers 100k requests/day, 1k KV writes/day. Worker fetches LS feed, normalizes, writes only changed records to KV. Pages Functions read same KV namespace. **Cron cadence is 60 minutes, not 30, to keep KV writes well under free-tier limits per §3.4 write-budget.**
- **Path B (default planning baseline): Manual CMS** — Astro Content Collection at `src/content/jobs/*.md`. Recruiter team edits, commits, deploys. Refreshed at deploy cadence (~2-3x/week). 1.A ships either path A or path B, not both.

**Decision gate:** if Zach gets explicit written LS-admin authorization to scrape or pull the feed by **2026-05-13 (1 week)**, Path A folds into Phase 1.A as a scope-add task track. Otherwise Phase 1.A ships Path B-only and Path A migration moves to Phase 1.5. Plan-writing proceeds against Path B in either case.

### 0.5.3 Final CSP (replaces existing block in `functions/_middleware.js:22-23`)

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://plausible.io https://challenges.cloudflare.com;
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self' https://plausible.io https://challenges.cloudflare.com;
frame-src https://challenges.cloudflare.com;
form-action 'self';
base-uri 'self';
frame-ancestors 'none';
```

Notes:
- `script-src 'unsafe-inline'` is required because Astro hydration injects inline scripts. We accept this — combined with `frame-ancestors 'none'` + `default-src 'self'` it remains a defense-in-depth, not a single-point CSP.
- `'unsafe-inline'` for `style-src` matches Astro's component-scoped style injection.
- `font-src 'self'` allows the self-hosted TAY woff2 served from `/fonts/*`.
- `connect-src` includes Plausible (analytics events POSTed to plausible.io) + Cloudflare Challenges (Turnstile server-side verification path uses `connect-src` only if hit from JS; the standard server-verify path is server-to-server which CSP does not constrain).
- `frame-src` allows the Turnstile challenge iframe.
- `form-action 'self'` allows POST to `/api/apply` and `/api/contact`.
- `img-src 'self' data:` only — no third-party image embeds at Phase 1.
- `base-uri 'self'` retained; canonical-block trailing semicolon kept for parser-tolerance.

### 0.5.4 Apply / contact route contracts

**Phase 1.A scope reduction:** No CV upload at launch. The apply form posts a lightweight contact-style payload only; recruiter follows up via email to request CV manually. This eliminates the malware-scanning gap, the Supabase Storage RLS dependency, and the signed-URL flow entirely from 1.A. CV upload + Supabase Storage + ClamAV ship together in Phase 1.5.

**Phase 1.A routes:**

| Route | Method | Body | Server actions | Response |
|---|---|---|---|---|
| `/api/apply` | POST | `name`, `email`, `phone`, `npi?`, `licenses[]`, `note`, `jobRef` (LS job ID for Path A, content-collection slug for Path B), `jobTitle` (denormalized for email subject), `turnstileToken` | Verify Turnstile → rate-limit (KV `rate:apply:{ipHash}`) → **Supabase row insert FIRST** (`ims_applications`) with `resend_status='pending'` → **THEN** Resend send to `recruiting@iastaffing.com` → update Supabase row with `resend_status='sent'` or `'failed'+resend_error` | `200 { ok: true, ref: "<uuid>" }` (whether or not Resend succeeded — row is source of truth) or `4xx/5xx { error }` if Turnstile / rate-limit / Supabase write fails |
| `/api/contact` | POST | `name`, `email`, `intent` (`coverage`/`general`), `message`, `turnstileToken` | Verify Turnstile → rate-limit (KV `rate:contact:{ipHash}`) → **Supabase row insert FIRST** (`ims_contact_messages`) → **THEN** Resend send → update Supabase row with `resend_status='sent'`/`'failed'` | `200 { ok: true }` or `4xx/5xx { error }` if Turnstile / rate-limit / Supabase write fails |
| `/api/jobs` | GET | querystring filters | **Path A:** read KV `jobs:index` → filter in-memory → return JSON. **Path B:** route does not exist (jobs render statically from Content Collection at build; client-side filter operates on the full list shipped in the page payload). | Path A: `200 { jobs: [...], _meta }`. Path B: 404 — `/jobs` is SSG, no API contract needed. |

**KV namespaces (required regardless of Path A vs Path B at Phase 1.A):**

- `IMS_RATE` — bound to Pages project as `RATE_KV`. Used for `rate:apply:{ipHash}` and `rate:contact:{ipHash}` keys with TTL = 600s. Required for BOTH Path A and Path B (form rate-limiting is path-independent).
- `IMS_JOBS` — bound to Pages project + Worker as `JOBS_KV`. **Path A only** (LS feed cache). Not provisioned for Path B-only deployments.

**Env vars (set in Cloudflare Pages dashboard, never committed):**

```
RESEND_API_KEY              # transactional email
RESEND_FROM_DOMAIN          # iastaffing.com (DKIM/SPF/DMARC verified)
RESEND_FROM_ADDRESS         # noreply@iastaffing.com
RECRUITING_TO_ADDRESS       # recruiting@iastaffing.com
SUPABASE_URL                # https://gbakzhibzotugfyktcrt.supabase.co (existing project; if Zach prefers separate IMS project, swaps here)
SUPABASE_SERVICE_ROLE_KEY   # server-side only, never exposed to client
PUBLIC_TURNSTILE_SITE_KEY   # client-side widget render; PUBLIC_ prefix exposes to Astro client islands
TURNSTILE_SECRET_KEY        # server-side verification only
PUBLIC_PLAUSIBLE_DOMAIN     # innovativemedicalstaffing.com
```

**Supabase tables (Phase 1.A):**

```sql
CREATE TABLE ims_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_ref         text,                          -- LS job ID (Path A) or content-collection slug (Path B)
  job_title       text,                          -- denormalized for email subject + recruiter view
  name            text NOT NULL,
  email           text NOT NULL,
  phone           text,
  npi             text,
  licenses        text[],
  note            text,
  ip_hash         text,                          -- sha256(ip + daily_salt) for rate-limit audit
  user_agent      text,
  created_at      timestamptz DEFAULT now(),
  status          text DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  resend_status   text DEFAULT 'pending' CHECK (resend_status IN ('pending','sent','failed')),
  resend_error    text                           -- last Resend error message if failed
);

CREATE TABLE ims_contact_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent          text NOT NULL CHECK (intent IN ('coverage','general')),
  name            text NOT NULL,
  email           text NOT NULL,
  message         text NOT NULL,
  ip_hash         text,
  user_agent      text,
  created_at      timestamptz DEFAULT now(),
  status          text DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  resend_status   text DEFAULT 'pending' CHECK (resend_status IN ('pending','sent','failed')),
  resend_error    text
);

ALTER TABLE ims_applications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ims_contact_messages ENABLE ROW LEVEL SECURITY;
-- No PUBLIC policies. Service-role-key only access from Pages Functions.
-- Recruiter team reads via Supabase Studio or future internal dashboard.
```

**Phase 1.5 adds:** `cv_uploads` Supabase Storage bucket with RLS `bucket_id = 'cv-uploads' AND auth.role() = 'service_role'` (no public reads, signed-URL access only with 60-minute TTL); `ims_applications.cv_storage_path text`; ClamAV scan via Supabase Edge Function before mark-complete.

### 0.5.5 Sitemap + indexability rules

- Marketing pages (`/`, `/clinicians`, `/facilities`, `/specialties`, `/about`, `/how-it-works`, `/contact`) — indexable, in sitemap.
- `/jobs` (root listing) — indexable, in sitemap, low priority (volatile).
- `/jobs?specialty=...&state=...` (filtered) — `<meta name="robots" content="noindex,follow">`, NOT in sitemap. Canonical points to root `/jobs`.
- `/jobs/[id]` (Phase 1.5) — indexable ONLY when JobPosting structured data ships (1.5 same release). Otherwise `noindex`. Sitemap includes only listings with `_lastSeenAt` within 24h.
- `/privacy`, `/cookies`, `/terms` (flat at root per §0.5.7) — indexable, low priority, in sitemap.
- `/api/*`, `/og/*` — `noindex`, NOT in sitemap.

### 0.5.6 Voice lint disposition

- v1 (Phase 1.A): advisory only. `npm run verify` runs the lint, prints findings as warnings, **does not block the build**.
- Phase 1.5: promote BANNED tier to blocking after team has reviewed v1 output.
- Phase 1.A deploy gate **does NOT** include "voice lint clean." Replaced with: "all committed copy reviewed at PR time against brief §21 BANNED list."

### 0.5.7 File paths + Astro routing

- Fonts: `public/fonts/TAY*.woff2` (woff fallback alongside). Astro serves these at `/fonts/*`. `@font-face url('/fonts/TAYBasalRegular.woff2')`.
- Logo SVGs: `src/assets/brand/IMS-Logo-*.svg`, imported as Astro components.
- Legal pages: `src/pages/privacy.astro`, `src/pages/cookies.astro`, `src/pages/terms.astro` — flat at root, NOT under `/legal/*`. Footer links use `/privacy`, `/cookies`, `/terms`.
- Specialty content: `src/content/specialties/[slug].md` (Astro Content Collection). Schema enforced via Zod in `src/content/config.ts`.
- Jobs (Path B fallback): `src/content/jobs/[slug].md` (Astro Content Collection).

### 0.5.8 Cookies / privacy stance

- Plausible Cloud, no cookies set, no banner needed (per Plausible's official guidance).
- `/cookies` page is informational only — explains we use Plausible, no tracking cookies, and lists the only first-party cookie (Cloudflare's `__cf_bm` bot-management cookie which is functional and exempt from EU consent under PECR).
- `/privacy` page covers PII handling: form-submitted data (apply + contact), Supabase storage location, retention (18mo for apply, 12mo for contact), deletion request flow (mailto `recruiting@iastaffing.com` with subject `Data deletion request`).
- DPA: Plausible Cloud has DPA available at plausible.io/dpa. Resend has DPA. Supabase has DPA. All three signed via standard click-through; no custom legal needed.

---

## 1. Site architecture (locked)

```
/                                    Home
/clinicians                          For Clinicians (supply path)
/facilities                          For Facilities (demand path)
/specialties                         Multi-specialty overview (12 editorial cards)
  /specialties/[slug]                Programmatic SEO pages (Phase 1.75)
/jobs                                Live LocumSmart job board (1.A: card grid)
  /jobs/[id]                         Per-job detail + apply (Phase 1.5)
/about                               Story, leadership, philosophy, values
/how-it-works                        4-step process (clinicians + facilities)
/contact                             Form + email + phone (no map at Phase 1; see §6 disposition)
robots.txt                           (X-Robots-Tag REMOVED at launch — hard gate)
sitemap.xml                          (auto via @astrojs/sitemap)
/og/[slug].png                       (programmatic OG, Phase 1.5)
```

**Top-12 editorial specialty set** (homepage grid + `/specialties` highlight): Anesthesiology · CRNA · Hospitalist · Emergency Medicine · Family Medicine · Psychiatry · OB/GYN · General Surgery · Radiology · Pediatrics · Cardiology · Neurology. Zach can drop any he can't credibly staff before launch; default = ship as-is.

**Page-level rules (apply to all pages):**

- Outer page background `var(--surface-page)` (PT-dark `#1E1E1E`).
- Inner content card sits on the dark exterior with `clamp(20px, 4vw, 64px)` of dark margin on all sides, giving the "rounded card on dark background" PT chrome.
- Card surface `var(--surface-card)` (PT-cream `#F2E8DC`).
- **Card chrome rule (resolves Codex NIT):** the cream card is a single continuous surface from top of hero through end of `/specialties` section, with all four corners `border-radius: clamp(20px, 5vw, 96px)` (top corners visible at hero entry; bottom corners visible if user reaches end of card before §2.5 dark inversion). Internal sections inside the card tile flush — no internal radius, no internal margins to the card edge.
- **§2.5 inverse section sits OUTSIDE the cream card DOM** — it's a sibling element in the `MarketingLayout`, full-width dark band (`var(--surface-page)`) with its own internal max-width container. After §2.5, a NEW cream card opens for §2.6→§2.9 with the same radius rules. §2.10 final-CTA is again outside the card (dark exterior).
- Max content width 1200px inside the card; prose max 64ch.
- Sticky nav appears at scroll-y > 80vh, not before.
- Footer is part of the dark exterior, NOT inside any cream card (matches PT footer language: dark-on-dark with cream type).

---

## 2. Homepage layout

10 sections per brief §14, in order. Each defines: layout intent, copy source, visual treatment.

### 2.1 Hero

**Card chrome:** cream rounded card sitting on dark exterior. Hero card spans ~85vh.

**Content (left ~60% of card width):**
- Eyebrow: `INNOVATIVE MEDICAL STAFFING` — TAY Basal, 14px, uppercase, letter-spacing 0.12em, `var(--brand-gold-muted)` (`#B8975B` — editorial gold; bright PT-yellow `#F0B420` reserved for value-tile underlines)
- Headline (display, TAY Basal, condensed if available): *"Medical staffing, handled with care."* — clamp(56px, 9vw, 96px), 1.05 line-height, `var(--ink-on-cream)`
- Body (TAY Amaya, 19px, 1.55 line-height): brief §16 paragraph 1 — *"Innovative Medical Staffing connects healthcare facilities with qualified clinicians through a more personal, responsive, and technology-enabled staffing experience."*
- Dual CTA: **primary** `Find Opportunities` (filled, navy `#1A2B4A` background, cream text, pill radius 999px) → `/jobs`; **secondary** `Request Coverage` (outline, navy 1.5px border, navy text, pill radius 999px) → `/contact?intent=coverage`. Visual hierarchy reads primary→secondary; ordering puts `Find Opportunities` first because clinician supply is the scarcer side.

**Visual (right ~40% of card width):**
- Custom hand-drawn illustrated character — IMS-specific commission: a clinician at a desk with a calm, warm posture (stethoscope laid down nearby, coffee cup, paper schedule), rendered in line-art with cream + brand-blue + brand-gold fills
- Decorative leaf or hand-drawn arc element in a corner (matches PT's leaf-in-corner motif from the screenshot)
- **NO photographic hero.** **NO crossed-arms doctor stock.** **NO blue gradient.** **NO AI mesh.**

**Initial illustration plan:** for v1 launch, ship a placeholder illustration set built from open-source line-art (e.g., Streamline Free or undraw.co) with cream + IMS-blue color overrides. Phase 1.5 commissions custom IMS illustrations from a freelance illustrator (~$800-1500 budget item, deferred).

**Motion:** 600ms fade + 8px rise on first paint, `cubic-bezier(0.22, 1, 0.36, 1)`. Nothing else moves at hero.

### 2.2 Positioning strip

Narrow band, full card width, hairline divider top + bottom. 4 columns, mono-style label per column (TAY Basal at 13px uppercase, `letter-spacing: 0.08em`):

`Locum Tenens Coverage` · `Multi-Specialty Staffing` · `Clinician Support` · `Facility Partnerships`

Reads like a magazine masthead. Charcoal-on-cream. No icons.

### 2.3 Philosophy

Single-column editorial. Generous vertical padding (`clamp(96px, 14vh, 200px)` top/bottom).

- **Pull-quote (TAY Basal display, 40-56px):** *"Staffing is more than filling a schedule. It is trust, timing, communication, and fit."*
- Em-dash signature line below in `var(--ink-on-cream-secondary)`: *— The IMS Team*

### 2.4 Audience split — two-card grid

Two equal cards inside the cream surface, with hand-drawn divider between them (vertical line + small ornament).

**Card 1 (For Clinicians):**
- Eyebrow: `FOR CLINICIANS`
- Headline (TAY Basal 32px): *"Opportunities with a team behind you."*
- 1-line tease (TAY Amaya 17px): *"Locum work that fits your goals, with details handled."*
- CTA: `Explore Clinician Path →` → `/clinicians`
- Hint visual: small line-art icon-pair (stethoscope + travel arc), navy strokes on cream

**Card 2 (For Facilities):**
- Eyebrow: `FOR FACILITIES`
- Headline (TAY Basal 32px): *"Coverage support you can trust."*
- 1-line tease (TAY Amaya 17px): *"Quality matching, responsive partnership, follow-through."*
- CTA: `Explore Facility Path →` → `/facilities`
- Hint visual: line-art icon-pair (calendar + handshake), navy strokes on cream

Cards: padding `clamp(32px, 4vw, 64px)`, hairline 1px border in `--border-hairline`, no drop shadow.

### 2.5 Concierge support — Before / During / After

The single inverse section in v1. Section breaks out of the cream card into a dark `var(--surface-page)` band with cream type — matches PT's contrast rhythm (cream-cream-dark-cream). 3-column grid:

- **Before assignment** — Clear role details · availability alignment · documentation · credentialing guidance · expectation setting
- **During assignment** — Responsive communication · schedule support · travel + lodging · real-time problem solving
- **After assignment** — Follow-up · feedback · future planning · continued relationship

Headlines in TAY Basal 28px, body in TAY Amaya 17px. Section closer (centered, italic TAY Amaya): *"From credentialing and travel to first-day preparation, our team stays close to the process."*

### 2.6 Human-led tech — split panel (back inside cream card)

Two-half panel inside the cream card, with hand-drawn divider arc between halves:
- Left half: cream — left-aligned headline TAY Basal 40px: *"Technology where it helps."*
- Right half: warm taupe `var(--surface-warm)` (`#A79785`) — right-aligned headline TAY Basal 40px: *"People where it matters."*
- Below the split, single body paragraph TAY Amaya 17px running across full width: *"Modern systems help us move faster, stay organized, and communicate clearly. Technology helps us reduce friction. Human judgment helps us make better matches."* (brief §10 say-this column).
- Single thin horizontal hand-drawn rule below = the only graphic.
- **NO AI mesh.** **NO neural-net visuals.** **NO data-stream lines.**

### 2.7 Specialties — 12-card grid

4×3 grid on cream. Each card:
- Specialty name (TAY Basal 24px)
- One-line framing in TAY Amaya 15px (e.g., CRNA → *"Independent and supervised practice across surgical settings."*)
- Live count: *`12 open opportunities`* (read at request time on Path A from KV `jobs:by:specialty:{slug}`; on Path B counted at build time from the Content Collection and re-rendered each deploy) — TAY Amaya 13px, navy
- Hover: card border darkens to navy + count gets navy underline → links to `/jobs?specialty=crna`

Sub-CTA below grid (centered): `View all specialties →` → `/specialties`.

### 2.8 Process — 4-step horizontal

Numbered (`01`→`04`) with thin connecting hand-drawn rules between steps. Tabbed by audience:

**Clinicians:** Submit CV → Onboarding → Schedule → Start
**Facilities:** Request → Match → Coordinate → Support

Tab toggle = pill, not full chrome. Default tab = Clinicians. Each step ≤14 words of body copy. Step numbers in TAY Basal 56px, step headlines in TAY Basal 22px.

### 2.9 Values — 6-tile grid (3×2)

Patient-First · Human-Led · Quality-Obsessed · Built on Trust · Detail-Minded · Calm Under Pressure. Each tile:
- Value name (TAY Basal 22px)
- 1-line definition from brief §6 (TAY Amaya 15px)
- Restrained gold underline beneath each name (`var(--brand-gold)`, 24px wide, 2px thick) — the only "decoration" in the section.

### 2.10 Final CTA

Mirrors PT's "LET'S GET TO WORK" footer-CTA pattern (per the user-provided screenshot reference):
- Full-bleed dark exterior section (NOT cream — matches PT)
- Headline in TAY Basal 56-72px display, cream on dark: *"Ready for a more thoughtful staffing experience?"*
- Single CTA pill in `var(--brand-blue-deep)` `#3898EC` (matches PT's "GET IN TOUCH" button density on dark): `Get in Touch` → `/contact`. NOT `--brand-blue` `#59BFE7` — that's the logo accent and is too low-contrast as a CTA fill on the dark exterior.
- Hand-drawn illustrated character to the right (e.g., second IMS character or supporting motif)
- Decorative leaf or hand-drawn ornament in lower-left

Below this, the footer (see §6).

---

## 3. Job board UX

### 3.1 `/jobs` (Phase 1.A — card grid, ships at launch)

**Layout:** left-side filter rail (240px sticky) inside the cream card, right-side card grid (3-up desktop, 2-up tablet, 1-up mobile).

**Filter rail (1.A scope):**
- Specialty (multi-select, defaults to top-12 + "All others")
- State (multi-select, US states present in feed)
- Length: `< 4 weeks` / `4-12 weeks` / `12+ weeks`

Filters update via URL search params (e.g., `/jobs?specialty=anesthesiology&state=TX`) — shareable, indexable structure for SEO. Implementation: Astro server-rendered first paint + tiny vanilla TS island for filter state changes.

**Card design (Phase 1.A):**
- Eyebrow row (TAY Basal 12px mono uppercase): specialty (gold) + length (teal)
- Headline (TAY Basal 24px): `{Facility type} · {City}, {ST}`
- Body (TAY Amaya 15px charcoal): call type · schedule pattern
- Pay range (TAY Amaya 15px navy bold): `$X – $Y / hr` — range only, NEVER exact
- CTA (per-job action, secondary hierarchy: hairline 1.5px navy border, navy text on cream — distinguished from hero's primary filled-navy CTA so users grok the hierarchy): `Apply through IMS →`
- Card chrome: 32px padding, 1px hairline border in `--border-hairline`, 16px radius, no shadow
- Hover: border darkens to navy + 1px translate-y up
- **NO facility logos** (locked: endorsement risk)

**Empty state:** *"No openings match those filters. Tell us what you're looking for and we'll reach out when one opens."* → mini form (specialty + state + email).

**Search bar:** deferred to Phase 1.5. Phase 1.A = filters only.

### 3.2 `/jobs/[id]` (Phase 1.5 — per-job detail)

**Layout:** 2-column on desktop (content 720px / sidebar 320px), single-column mobile, all inside the cream card.

**Content column:**
1. Eyebrow: specialty + length + call type
2. Headline: `{Facility type} · {City}, {ST}` — facility name only if LocumSmart explicitly clears, otherwise pattern like "100-bed acute-care hospital"
3. Concierge framing block (warm-taupe surface, navy type): *"What onboarding looks like in {state}"* — pulls boilerplate concierge content keyed by state (credentialing, lodging guidance, response-time promise)
4. Job details: dates, schedule, pay range, EMR if known, contact-coverage notes
5. Apply CTA → form (sidebar)

**Sidebar:**
- Apply form (Through-IMS — see 3.3)
- IMS team contact card with single recruiter avatar (placeholder cream silhouette at v1) + name + direct line + email — concierge first-touch promise

### 3.3 Apply flow

**Phase 1.A scope (locked, no CV upload):**

1. User clicks `Apply through IMS` on card. Modal opens (single page, not multi-step wizard — concierge brand promise = first-touch is human, not gamified).
2. Form fields: `name` · `email` · `phone` · `NPI (optional, format-validated if provided)` · `current state license(s)` · `note (1 line, "What attracted you?")` · `jobRef` (hidden — LS job ID on Path A or content-collection slug on Path B) · `jobTitle` (hidden — denormalized for email subject + recruiter view) · `turnstileToken` (from Turnstile widget). The card grid passes `jobRef` and `jobTitle` into the modal as data attributes when the user clicks `Apply through IMS`; the modal initializes its hidden form fields from those attributes.
3. Client posts JSON to `/api/apply` (route contract in §0.5.4).
4. Server-side, in this order: verify Turnstile token → check rate-limit KV (`rate:apply:{ipHash}`) → **Supabase row insert FIRST** (`ims_applications`) with `resend_status='pending'` → **then** Resend email to `recruiting@iastaffing.com` (template includes all fields + applicant note + `jobTitle`/`jobRef` for context) → update Supabase row with `resend_status='sent'` or `'failed'+resend_error` → return `{ ok: true, ref: <uuid> }`. Source of truth is the Supabase row; Resend is a notification side-effect that must not block confirmation.
5. Confirmation in modal: *"We received your application for {jobTitle}. {Recruiter name} from our team will be in touch within 1 business day."* — sets expectation; the human follow-up is the brand moment. CV requested in the recruiter's reply email, NOT collected on the form at v1.

**Phase 1.5 adds:**
- CV upload field (PDF/DOCX, ≤10MB) with MIME-type whitelist server-side.
- Supabase Storage bucket `cv-uploads` (private, RLS service-role-only access). Signed URLs with 60-minute TTL for recruiter access.
- ClamAV malware scan via Supabase Edge Function before mark-complete; rejected uploads return user-friendly error + audit log entry.
- Retention: 18 months from upload, auto-delete via Supabase scheduled function (`cv_uploads_retention.sql`).
- `cv_storage_path` column added to `ims_applications`.

**Anti-spam (Phase 1.A):**
- Honeypot field (CSS-hidden `phone_alt`) — submissions with that field populated are silently dropped + logged.
- Cloudflare Turnstile (free tier, no UX friction). Public site key + private secret key set as env vars per §0.5.4.
- Per-IP rate-limit at Pages Function via KV (`rate:apply:{ipHash}` and `rate:contact:{ipHash}`): 3 submissions / 10 minutes; soft-fail with *"You're submitting a bit fast — give us a moment to catch up."* Limit applies per route; bypass key (`X-IMS-Test-Bypass`) supported for monitoring synthetic checks.

**Failure semantics (Phase 1.A):**

For atomicity without the complexity of distributed transactions or queue infrastructure at v1, the route writes the Supabase row **first**, then attempts Resend send. The Supabase row carries a `resend_status` enum (`pending`, `sent`, `failed`) updated after the Resend call.

- **Supabase write failure (no row persisted):** return `502` to user with retry-friendly message *"Something on our end glitched — your submission did NOT go through. Try again, or email recruiting@iastaffing.com directly."* No Resend attempt is made.
- **Supabase row persisted, Resend send succeeds:** mark `resend_status='sent'`, return 200 to user.
- **Supabase row persisted, Resend send fails:** mark `resend_status='failed'`, log incident, return 200 to user (the row is the source of truth; recruiter has a backfill view in Supabase Studio of all `resend_status='failed'` rows). **No automatic retry at v1** (avoids reintroducing the cron-mechanism dependency Codex flagged). Phase 1.5 adds a Scheduled Worker `ims-resend-outbox` that periodically retries failed sends — out of scope for 1.A.

Recruiter team is briefed on the `resend_status='failed'` query as part of launch onboarding so missed emails surface within ~24h.

### 3.4 LocumSmart data pipeline

**Path A — Scheduled Worker (scope-add to Phase 1.A if LS auth granted by 2026-05-13; else migrates to Phase 1.5):**

```
LocumSmart API/feed
       │ (Cloudflare Scheduled Worker, cron 0 * * * * — top of every hour)
       ▼
Worker `workers/jobs-sync/src/index.ts`
       │  - fetch LS feed with auth credentials from Worker secrets
       │  - dedupe by LS job ID
       │  - normalize specialty (canonical list at src/data/specialties.json)
       │  - normalize state (USPS 2-letter)
       │  - rate-range sanitize (drop rate if low > high; keep listing with "Rate on request")
       │  - tag `_lastSeenAt` ISO timestamp
       │  - 2-sync-miss → mark stale; 24h grace → delete
       ▼
Cloudflare KV namespace `IMS_JOBS` (binding `JOBS_KV` in both Worker and Pages):
  - `jobs:index`           full list, brotli-compressed JSON, max ~25KB per KV docs
  - `jobs:by:specialty:{slug}`
  - `jobs:by:state:{ST}`
  - `jobs:byid:{id}`
  - `jobs:_meta`           { lastSyncAt, lastSyncDurationMs, syncErrorCount, unknownSpecialties[] }
       │
       ▼
`/jobs` SSR via Pages Function reads KV → renders Astro layout server-side
`/jobs/[id]` (Phase 1.5) reads `jobs:byid:{id}` from KV
Homepage 12-card grid reads `jobs:by:specialty:{slug}` for live counts
```

**Wrangler config** (`workers/jobs-sync/wrangler.toml`):

```toml
name = "ims-jobs-sync"
main = "src/index.ts"
compatibility_date = "2026-05-06"

kv_namespaces = [
  { binding = "JOBS_KV", id = "<production_id>", preview_id = "<preview_id>" }
]

[triggers]
crons = ["0 * * * *"]

[vars]
LS_FEED_BASE_URL = "https://locumsmart.example/feed"

# Secrets (set via wrangler secret put):
# LS_FEED_AUTH_TOKEN
```

Pages Functions in the IMS website project bind the SAME namespace `IMS_JOBS` as `JOBS_KV` for read-only access in `/api/jobs` and SSR routes.

**KV constraints + handling:**
- KV value max 25 MiB; the app budget for `jobs:index` is ≤500KB, achieved by storing a slim per-listing record (id, specialty, state, length, rateLow, rateHigh, callType) and fetching the full record from `jobs:byid:{id}` on detail-page request.
- KV writes are eventually consistent (≤60s global propagation). UI reads are tolerant — "Updated N minutes ago" microtype is honest about staleness.
- **Cloudflare KV Free tier limits:** 1,000 writes/day, 100,000 reads/day, 1 GB storage. Workers Cron Free tier covers cron triggers.
- **Write-budget plan (revised after Codex round 2 found math error):** cron cadence drops to **every 60 minutes** (24 runs/day, not 48). Worker fetches full LS feed, hashes each listing's payload, compares against an in-memory map of last-seen hashes (rebuilt at Worker start from `jobs:_meta.hashes`), and **writes only changed records**. Worst-case daily writes: 24 (always-rewrite `jobs:index` + `jobs:_meta`) + ~50 (assume ≤50 listings change per day on average across a low-thousands-listing feed) = ~74 writes/day. Comfortable margin under 1k cap. Burst day with 500 listings changing = ~524 writes — still under cap.
- **Reads budget:** page views × ~3 KV reads (index + per-specialty + per-id). At 11k pageviews/day = 33k reads/day, well under 100k cap.
- **If feed scale exceeds estimates** (e.g., LS feed turns out to be 5k+ active listings with high churn): upgrade to Workers Paid ($5/mo) which lifts KV limits to 1M writes/day. Within Phase 1 ≤$10/mo cost envelope.

**Path B — Manual CMS fallback (ships if LS auth blocked at 2026-05-13):**

- Astro Content Collection at `src/content/jobs/[slug].md` with Zod schema enforcing required fields.
- Recruiter team edits via PR (or Decap CMS / Sveltia CMS web UI in Phase 1.5 if PR-friction is too high).
- `/jobs` reads from Content Collection at build time (SSG, no KV); rebuild + redeploy on every job change (~2-3x/week cadence acceptable for v1).
- Filter rail still works (URL params; static-generated filtered pages OR client-side filter on full list).
- Migrates to Path A in Phase 1.5 when LS auth resolves.

**Path-default decision (resolves Codex round-2 NO-GO on plan-concreteness):** **Path B is the default planning baseline.** Plan-writing proceeds against Path B (manual Astro Content Collection, no Worker, no KV in 1.A). If Zach gets explicit written LS-admin authorization by **2026-05-13**, the writing-plans phase folds the Path A scope-add as an additional task track inside Phase 1.A. If 2026-05-13 passes without authorization, Phase 1.A ships Path B-only and Path A migration moves into Phase 1.5 scope.

This eliminates the "planning blocked on external decision" risk: Path B is concrete and ships, Path A is a scope-add if/when authorization lands.

**Dirty data handling (echoes rate-sim track lessons — `_lastSeenAt` 2-sync-miss → 24h grace → drop):**
- Listings absent for 2 consecutive syncs → marked stale (`_stale: true`), kept visible 24h with subtle "Updated 12 hours ago" microtype, then dropped
- Rate ranges where low > high → drop the rate, keep listing with "Rate on request" + `Apply through IMS for precise rate` CTA
- Specialty values not in canonical list → bucketed under "Other" + logged to `jobs:_meta.unknownSpecialties` for monthly review

**LocumSmart auth:**
- Phase 1.A Path A: cron pulls publicly-accessible LS job feed if available, OR scrapes the LS job board page via cron with respectful rate (1 fetch / 60 min) + LS admin-authorized scraping approval (open Zach action). Phase 1.A Path B: no cron, refresh on deploy.
- Phase 2: webhook upgrade once LS admin grants subscription access — eliminates 60-min staleness window

**Cost:** Cloudflare Pages free tier covers cron + KV + Functions for v1 traffic levels. Resend free tier ≥3k emails/mo absorbs apply-flow.

---

## 4. Brand system

### 4.1 Palette tokens (PT-derived, IMS-adjusted)

```css
/* Page chrome — PT exact */
--surface-page:        #1E1E1E;   /* dark outer container */
--surface-card:        #F2E8DC;   /* cream inner card (the "rounded panel") */
--surface-card-2:      #FFFAF3;   /* lighter cream alt for tonal layering (illustration container fills) */
--surface-warm:        #A79785;   /* warm taupe (mid-section bg, §2.6 right half) */

/* Inks */
--ink-on-cream:        #1E1E1E;   /* near-black body on cream surfaces */
--ink-on-cream-2:      #7B5E5C;   /* secondary text (muddy brown), microtype */
--ink-on-cream-3:      #403F3E;   /* tertiary, captions */
--ink-on-dark:         #F2E8DC;   /* cream body on dark surfaces */
--ink-on-dark-2:       #C8C8C8;   /* secondary on dark */

/* Brand */
--brand-blue:          #59BFE7;   /* IMS logo blue, KEPT (PT context defangs "generic medical blue" warning) */
--brand-blue-deep:     #3898EC;   /* PT button blue, used for primary CTAs on dark surfaces */
--brand-navy:          #1A2B4A;   /* navy for primary CTAs on cream + display headline accent */
--brand-gold:          #F0B420;   /* PT yellow — primary brand accent, eyebrows + value underlines */
--brand-gold-muted:    #B8975B;   /* IMS-brief-spec gold, used in editorial moments where #F0B420 is too bright */
--brand-red:           #E73C37;   /* PT red — sparingly, for active state / important alerts */
--brand-teal:          #3D6B6F;   /* IMS-brief-spec muted teal, accent for clinician-side cards */
--brand-green:         #2F4A40;   /* IMS-brief-spec deep green, accent for facility-side cards */

/* Borders */
--border-hairline:     rgba(30, 30, 30, 0.12);
--border-strong:       rgba(30, 30, 30, 0.32);

/* Functional */
--success:             #2F6B4A;
--warning:             #B87A1F;
--error:               #A33A2C;
```

These layer on top of existing `IAS-Design-System.md` tokens. Marketing surfaces use `--surface-card`/`--surface-page` chrome; embedded dashboard surfaces (Phase 3+ migration) keep their existing token scale.

### 4.2 Typography

**Self-hosted from `public/fonts/`** (woff2 + woff fallback served at `/fonts/*`, license verified Standard EULA — Webfont Use clause, IMS <50 employees).

- **Display + headlines:** `TAY Basal Regular` (one weight available; we use it across all display/headline sizes via size+letter-spacing variation)
- **Body + UI:** `TAY Amaya` (one weight available; we use it across body/microtype, italic via CSS synthesis where needed — to be evaluated at first paint)

**`@font-face` block (in `src/styles/tokens.css`):**

```css
@font-face {
  font-family: 'TAY Basal';
  src: url('/fonts/TAYBasalRegular.woff2') format('woff2'),
       url('/fonts/TAYBasalRegular.woff') format('woff');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'TAY Amaya';
  src: url('/fonts/TAYAmaya.woff2') format('woff2'),
       url('/fonts/TAYAmaya.woff') format('woff');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

:root {
  --font-display: 'TAY Basal', 'Source Serif 4', 'Georgia', serif;
  --font-body:    'TAY Amaya', 'Inter', system-ui, sans-serif;
  --font-mono:    ui-monospace, 'JetBrains Mono', Consolas, monospace;
}
```

**Fallback rationale:** if either TAY font fails to load, fallback chain keeps display→serif and body→sans-serif character intact. `font-display: swap` prevents FOIT.

**Scale:**

| Role | Size (clamp) | Line | Weight | Family |
|---|---|---|---|---|
| Display 1 (hero H1) | clamp(56px, 9vw, 96px) | 1.05 | 400 | display |
| Display 2 (Section H1) | clamp(40px, 5vw, 64px) | 1.10 | 400 | display |
| H2 | 32-40px | 1.20 | 400 | display |
| H3 | 22-28px | 1.30 | 400 | display |
| Body L | 19px | 1.55 | 400 | body |
| Body | 17px | 1.60 | 400 | body |
| Body S | 15px | 1.55 | 400 | body |
| Microtype | 13px | 1.40 | 400 | body |
| Eyebrow (mono uppercase) | 12-14px | 1.40 | 400 | display, letter-spacing 0.10em |

**Validation step at first paint (Codex AMBER fold):** measure rendered TAY Basal at hero-display size 56-96px. CSS `font-weight` synthesis on a single regular weight is unreliable. If TAY Basal at 96px reads too light against the cream surface, the approved fallback is **Inter Variable 700-900** (display) + TAY Basal stays as the body+sub-display font. Decision recorded in `docs/IAS-Design-System.md` typography section after first deploy. Same check for TAY Amaya at 19px body — fallback is Inter Variable 400 if it reads too quirky for legibility.

### 4.3 Logo

**Decision flipped from prior brainstorm:** keep IMS logo at original `#59BFE7` sky blue. The "boutique editorial Apple" direction triggered the brief §20 "avoid generic blue medical gradients" warning; the PT-aesthetic context (cream card + hand-drawn illustrated character + warm taupe accents + dark exterior chrome) renders the logo blue as friendly editorial accent rather than generic medical signaling.

**Variants to generate** (save originals first to `src/assets/brand/IMS-Logo-Original.svg`):

| Variant | cls-1 (swoop) | cls-2 (MS letters) | Use |
|---|---|---|---|
| `IMS-Logo-Default.svg` | `#59BFE7` (original sky blue) | `#1E1E1E` (near-black for cream surfaces, was `#F4F5F5`) | Default on cream/card surfaces — PRIMARY |
| `IMS-Logo-OnDark.svg` | `#59BFE7` | `#F2E8DC` | On dark exterior surfaces (footer, hero CTA dark band) |
| `IMS-Logo-Mono.svg` | `currentColor` | `currentColor` | Inherits ink, used in print, email signatures, fallback |
| `IMS-Logo-Original.svg` | `#59BFE7` | `#F4F5F5` | Archive only, not rendered |

Implementation: inline as Astro components (`<LogoDefault />`, `<LogoOnDark />`, `<LogoMono />`) for crispness + accessibility (`role="img"` + `aria-label="Innovative Medical Staffing"`). Min height 32px, max-width capped per nav/footer/hero context.

### 4.4 Motion + easing

- **Fade-in on first paint:** 600ms, `cubic-bezier(0.22, 1, 0.36, 1)` (`--ease-out-quart`)
- **Hover transitions:** 180ms, `ease-out`
- **Scroll-reveal sections:** 500ms fade + 12px rise, IntersectionObserver-triggered, **once only** (no re-entry animation), root-margin `-10%`
- **Reduced-motion:** `prefers-reduced-motion: reduce` → strip all transforms, keep opacity transitions only

**NO** parallax · marquee · auto-rotating carousel · floating particles · glassmorphism · neumorphism · Lottie animations as primary content (small accent OK).

### 4.5 Voice + visual lints

Build-time check (`scripts/voice-lint.mjs`, runs in `npm run verify`). **Advisory mode at v1** — `npm run verify` prints findings as warnings to stderr, exits 0 regardless. **Not a Phase 1.A launch gate** (per §0.5.6). Promoted to blocking at Phase 1.5 after Zach reviews v1 output and confirms the BANNED list isn't catching false positives.

```js
// Banned tokens (case-insensitive whole-word) — WARN at v1, BLOCK at Phase 1.5
const BANNED = [
  "streamline", "streamlining", "solutions", "premier",
  "disrupt", "disruptive", "scale", "gig", "rockstar",
  "ninja", "game-changing", "best-in-class", "cutting-edge",
  "seamless", "seamlessly", "revolutionize", "revolutionary",
];
// Use-carefully tokens — WARN always
const CARE = ["AI", "platform", "pipeline", "database"];
// Forbidden visual cliches (matched against Astro frontmatter `visualNotes` field) — WARN at v1
const VISUAL_BANNED = [
  "crossed-arms", "stethoscope-stock", "neural-mesh", "data-stream",
  "blue-gradient-medical", "hospital-hallway-stock",
];
```

Greps `.astro` + `.md` + `.mdx` files. Output: line-numbered warnings printed during `npm run verify`. Non-zero exit only at Phase 1.5 promotion. CI runs `npm run verify` on every push.

**What this does in plain language:** the script is a safety net that catches generic-recruiter-marketing words and stock-photo cliches the brief said to avoid. At v1 it just lists them as warnings during build so Zach can see what got flagged and override case-by-case. At Phase 1.5 it can graduate to blocking the build if those terms slip in. This is a guardrail, not a gatekeeper.

### 4.6 Spacing, radius, borders

- **Spacing scale** (8px base): 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96 / 128 / 160
- **Radius scale (PT-style vw-based for the card chrome, fixed-px for components):**
  - Hero card outer corners: `clamp(20px, 5vw, 96px)`
  - Section cards: 16px
  - Audience-split cards: 24px
  - Buttons / CTAs: 999px (pill, matches PT's "GET IN TOUCH" button)
  - Form inputs: 8px
  - Images / illustration containers: 24px
- **Borders:** hairline 1px `var(--border-hairline)`, strong 1px `var(--border-strong)`. **NO drop shadows.** **NO insets.**

### 4.7 Iconography + illustration

**Two systems:**

1. **Functional icons** (UI affordances: chevron, search, close, external-link arrow, etc.) — inline custom SVG, 24px standard, navy stroke 1.5px on cream / cream stroke 1.5px on dark. Set lives in `src/assets/icons/`, ≤8 icons at Phase 1 launch.

2. **Editorial illustration** (hero character, footer-CTA character, decorative leaves/arcs) — hand-drawn line-art SVGs. **Phase 1.A:** sourced from open-source library (Streamline Free / undraw.co / Open Doodles) with palette-recolor to match IMS tokens. **Phase 1.5:** commission custom set from freelance illustrator (~$800-1500 budget) for hero + footer-CTA + 2 secondary characters.

**Illustration palette:** strokes in `var(--ink-on-cream)`, fills using `--brand-blue` + `--surface-card-2` + `--brand-gold` accents. Match PT's "blue blob with coffee + leaf" energy — friendly, hand-drawn, not corporate-vector.

**Forbidden illustration sources:** AI-generated illustrations from Midjourney/DALL-E/SD (over-rendered, generic), iStock/Shutterstock corporate vectors (sterile), generic doctor stock photos (brief §20 explicit).

---

## 5. Implementation phasing

### Phase 1.0 — Foundation (deploy 0; remains noindex)
- Layout primitives (`MarketingLayout.astro` derived from `BaseLayout.astro`, replacing dashboard-dark chrome with PT-cream chrome)
- Brand tokens loaded into `src/styles/tokens.css`
- Font self-hosting via `@font-face` (TAY Basal + TAY Amaya served from `/fonts/*` route)
- Logo variants (`Default`, `OnDark`, `Mono`) generated from `IMS-Logo-Original.svg`
- Voice + visual lint script in CI (advisory mode)
- IntersectionObserver scroll-reveal helper

**Deploy gate:** Lighthouse ≥95 on Performance/A11y/Best Practices/SEO for `/` (still maintenance page). Voice lint runs without errors.

### Phase 1.A — Marketing pages + minimal `/jobs` (LAUNCH)
All marketing pages per §1: Home (10 sections per §2) · `/clinicians` · `/facilities` · `/specialties` (12 cards, no `[slug]`) · `/about` (with leadership placeholder cards) · `/how-it-works` · `/contact` (form + email + phone). `/jobs` ships as card grid with filter rail (§3.1). Apply flow ships as **lightweight contact form (no CV upload)** modal on card click — see §3.3 Phase 1.A scope. No `/jobs/[id]`.

**Pre-deploy hard checks — TECHNICAL (machine-verifiable, all must pass):**

1. `functions/_middleware.js` CSP replaced with §0.5.3 final block; `X-Robots-Tag: noindex, nofollow` REMOVED from line 20 AND `public/_headers:2`.
2. `/robots.txt` updated → `User-agent: *\nAllow: /\nSitemap: https://innovativemedicalstaffing.com/sitemap.xml`.
3. `@astrojs/sitemap` integration installed and configured per §0.5.5 (excludes `/api/*`, `/og/*`, `/jobs?...filtered`).
4. `@astrojs/cloudflare` adapter installed; `output: "hybrid"` set in `astro.config.mjs`. **Path A SSR routes built:** `/jobs`, `/api/apply`, `/api/contact`, `/api/jobs`. **Path B SSR routes built:** `/api/apply`, `/api/contact` only — `/jobs` is SSG from Content Collection. (`/jobs/[id]` is Phase 1.5 regardless of path — NOT in 1.A.)
5. **Both paths (always required):** KV namespace `IMS_RATE` provisioned + bound to Pages project as `RATE_KV` (used for form rate-limiting). **Path A only:** additionally provision KV namespace `IMS_JOBS` bound to Pages + Worker as `JOBS_KV`; Scheduled Worker `ims-jobs-sync` deployed and observed completing one full sync cycle without error. **Path B only:** `src/content/jobs/` Content Collection populated with ≥10 real listings; recruiter team has been onboarded to the edit + PR + deploy workflow.
6. Resend domain `iastaffing.com` SPF + DKIM + DMARC records verified. `RESEND_API_KEY`, `RESEND_FROM_*`, `RECRUITING_TO_ADDRESS` env vars set in Pages dashboard.
7. Turnstile site + secret keys provisioned; widget renders on `/contact` and apply modal; server-side verification path tested with both pass + fail tokens.
8. Supabase tables `ims_applications` + `ims_contact_messages` created with RLS enabled (per §0.5.4 SQL); service-role-key env var set in Pages dashboard.
9. Lighthouse ≥95 (Performance/A11y/Best Practices/SEO) on sample: `/`, `/clinicians`, `/facilities`, `/jobs`, `/about`.
10. Plausible installed (script + `<head>` snippet) + 4 conversion goals registered: `cta_find_opportunities`, `cta_request_coverage`, `application_submitted`, `contact_form_submitted`. (Goal-fire validation moved to §8 post-launch validation, NOT a launch gate.)
11. WCAG AA contrast verified for `--brand-blue` (`#59BFE7`) on cream `#F2E8DC` and on `#1E1E1E`; `--brand-gold-muted` `#B8975B` on cream; navy `#1A2B4A` on cream. Failing pairs swap to compliant variant or get a contrast-boosted state for text-bearing usage. Decisions recorded in `docs/IAS-Design-System.md` color audit section.
12. End-to-end smoke: submit `/api/contact` and `/api/apply` with valid + invalid Turnstile tokens; verify expected behavior — on valid: Supabase row persists FIRST with `resend_status='pending'`, THEN Resend send completes and `resend_status` flips to `'sent'`, then 200 returned to caller. On invalid: 4xx, no Supabase row, no Resend send. Rate-limit kicks in after 4th submission within 10min from same IP. Forced Resend failure (e.g., revoke API key transiently) leaves Supabase row at `resend_status='failed'` with `resend_error` populated; user still receives 200.

**Pre-deploy soft gates — PROCESS (human-approval, all must be acknowledged):**

13. Zach has reviewed leadership placeholder cards and either green-lit launch with placeholder OR sent real headshots+names+roles.
14. DNS DS record at Namecheap for DNSSEC (Key Tag 2371, Algo 13, Digest Type 2, Digest `E87E0FAA4A721D1DB10ECD41DE219002F4988B65DF61D51C65C93074C3E951E3`) — already on Zach's open queue.
15. Privacy + cookies + terms pages drafted at `src/pages/{privacy,cookies,terms}.astro` and Zach-reviewed before launch (per §0.5.8 stance). Reviewer artifact: a `/legal-review/` PR comment from Zach approving content.
16. LocumSmart authorization status confirmed (Path A or Path B locked per §3.4 default-Path-B rule).
17. Final copy review pass: a designated reviewer (default: Zach) walks all committed copy against brief §21 BANNED list. Approval recorded as a PR comment on the launch-tagged PR. Voice-lint script runs as advisory in CI; this is the actual gate.

**Tag commit `v1.0.0-launch`. GitHub release.** This is the "first indexable site" moment.

### Phase 1.5 — Discovery + per-job depth (~2 weeks post-launch)
- `/jobs/[id]` per-job pages (§3.2) with **Schema.org `JobPosting` structured data shipped in the same release** (Codex AMBER fold: detail pages do NOT go live without JobPosting). If structured data slips, detail pages start `noindex` until JobPosting markup ships.
- Faceted search bar on `/jobs` (full-text on title/specialty/state via Pagefind, build-time index).
- Programmatic OG images at `/og/[slug].png` (Astro endpoint via `satori`).
- CV upload field added to apply form (§3.3 Phase 1.5 scope) + Supabase Storage bucket `cv-uploads` + ClamAV scanning + signed-URL recruiter access.
- Application form receipt sent to applicant (transactional email confirming submission).
- Voice lint promoted from advisory to blocking for BANNED terms.
- LS Path B → Path A migration if launched on Path B.

**Phase 1.5 ship gate:** all 1.5 features tested in staging, no regressions to 1.A surface. **Phase 1.5 → 1.75 unlock criterion (separate from ship gate):** organic search impressions tracked in Plausible/GSC AND ≥1 application/week through the form for 2 consecutive weeks. If unlock criterion isn't met, 1.5 stays live; 1.75 doesn't start until signal warrants.

### Phase 1.75 — Programmatic specialty SEO (~3 weeks post-1.5)
- `/specialties/[slug]` for top-12 specialties (Astro Content Collection schema-validated via Zod).
- 600-1000 words per page IMS-voice content (drafted in-house, Zach voice-pass before publish).
- Internal linking strategy: `/specialties/[slug]` ↔ `/jobs?specialty=[slug]` ↔ relevant `/about` anchors.
- LocumSmart webhook upgrade (replace 60-min cron) once LS admin grants subscription access.

**Deploy gate:** `/specialties/[slug]` indexed for ≥6 of 12 specialties before declaring 1.75 done.

### Phase 1.9 — Reserved / case-by-case
Trigger items into separate specs when signal warrants:
- Locum income calculator (only after rate-sim track gives validated rate data — currently in `ias-dashboard/` Phase F)
- Resources/blog (only when 5-10 real posts queued)
- Joint Commission cert pursuit start (Zach decision, 6-12mo lead time)
- ATS integration when application volume justifies (Bullhorn/JobDiva eval)
- Custom illustration commission (~$800-1500 budget)

### Phase 3+ — Dashboard migration behind verified login
**Backlog item:** [migrate IAS dashboard behind @iastaffing.com login](file:///C:/Users/oclou/.claude/projects/c--Users-oclou-QueenClaude/memory/projects/project_ims_website_dashboard_migration_locked_login_BACKLOG_2026-05-06.md). Triggered post-launch, separate spec.

### Build dependency graph

```
Phase 1.0 Foundation
    └── Phase 1.A Marketing pages
            ├── /jobs grid (1.A)
            │       ├── [Path B default] Astro Content Collection seed + Zod schema (1.A)
            │       ├── [Path A scope-add if LS auth lands] LocumSmart Worker + KV (1.A or 1.5)
            │       └── /jobs/[id] (1.5)
            │               └── Faceted search (1.5)
            │               └── Programmatic OG (1.5)
            │               └── Schema.org JobPosting (1.5)
            └── /specialties grid (1.A)
                    └── /specialties/[slug] (1.75)
```

### Runtime + cost

- **Cloudflare Pages** (Free): build + deploy + Pages Functions + custom domains.
- **Cloudflare KV** (Free) for both paths: namespace `IMS_RATE` for form rate-limiting (~50 writes/day at launch volume).
- **Cloudflare Workers + KV** (Free) on Path A only: Scheduled Worker `ims-jobs-sync` and additional KV namespace `IMS_JOBS` (~74 writes/day average per §3.4). Workers Cron Triggers free. Free-tier write cap 1k/day comfortably covers both namespaces combined.
- **Cloudflare Turnstile** (Free): unlimited.
- **Resend** (Free tier, 3k emails/mo): apply + contact form notifications. Verified domain `iastaffing.com` required.
- **Supabase** (Free tier): `ims_applications` + `ims_contact_messages` tables; CV upload + Storage bucket are PHASE 1.5, not 1.A — so Phase 1.A row volume is well under free-tier limits (50k MAU equivalent).
- **Plausible Cloud** ($9/mo): analytics. Privacy-friendly, no cookie banner needed (per §0.5.8).

**Total Phase 1.A monthly recurring cost:** ~$9/mo (Plausible Cloud only; everything else free tier). Workers Paid ($5/mo) only triggered if KV write/read estimates blow past free tier — total still ≤$15/mo within Phase 1 cost envelope.


### Risks + mitigations

| Risk | Mitigation |
|---|---|
| LocumSmart feed quality (rate low > high seen on rate-sim track) | Pipeline drops bad rates, keeps listing with "Rate on request" |
| LocumSmart admin hasn't authorized scraping | Phase 1.A is unblocked: Path B (manual Astro Content Collection edited by recruiter team) is the default planning baseline. Path A (Worker + KV pulling LS feed) is a scope-add if LS authorization lands by 2026-05-13; otherwise migrates into Phase 1.5. |
| Leadership placeholder cards reads cheap at launch | Cream silhouette + role only, NO stock photos, "Photos coming soon" microtype |
| Voice lint blocks legitimate use cases (e.g., "scale" in clinical context) | Use-carefully tier always WARN-only; BANNED tier WARN-only at v1, manually graduated to BLOCK at 1.5 after Zach review |
| Workers Cron 60-min cadence misses fast-fill jobs (Path A) | KV cache labels `_lastSeenAt`; client-side stamp "Updated N minutes ago" sets honest expectation. Path B has even greater latency (deploy cadence ~2-3x/week) but fast-fill jobs are rare in locum staffing. |
| Apply-form spam | Honeypot + Cloudflare Turnstile + Pages Function rate-limit |
| Brand voice drift across pages drafted in-house | Voice lint + Zach pass before each phase ships |
| TAY font display weight too light at 56px+ display sizes | Validation step at first paint; if light, supplement with CSS synthesis or fall back to Source Serif 4 700 |
| Custom illustration unavailable until 1.5 commission | Phase 1.A uses open-source library (Streamline Free / Open Doodles) with palette recolor; 1.5 swaps in custom commission |
| `_middleware.js` headers vs `public/_headers` divergence (X-Robots-Tag must be removed from BOTH at launch) | Launch checklist explicitly names both files; CI lint script (Phase 1.5) fails build if `noindex` re-introduced |
| **PII retention + compliance (Codex AMBER fold)** — apply + contact forms collect name, email, phone, NPI, license states, IP. Privacy policy obligations under US state laws (CA/CO/CT/UT/VA), GDPR for any EU traffic | Privacy page documents data collected, retention windows (18mo applications, 12mo contacts, IP-hashed not raw), deletion request flow (mailto). Service-role-only Supabase RLS prevents inadvertent PUBLIC reads. CV upload deferred to 1.5 reduces 1.A blast radius. DPAs signed with Plausible/Resend/Supabase. |
| **TAY font subsetting + load weight** — both fonts ship as full character sets (~30KB woff2 each). On critical-path render | Font-display: swap prevents FOIT. Phase 1.5 considers subsetting via `pyftsubset` to Latin Extended only (~10KB each) if Lighthouse perf score drops |
| **`/jobs?...filtered` SEO duplicate-content risk** — same jobs reachable from many filter combos | Filtered pages set `<meta name="robots" content="noindex,follow">` + `<link rel="canonical" href="/jobs">` (per §0.5.5). Sitemap excludes filtered URLs. |
| **Cloudflare free-tier limits** — KV writes 1k/day, Workers requests 100k/day, build minutes 500/mo | **`IMS_RATE` namespace (both paths):** form rate-limit writes are 1 per submission, ≤50 submissions/day expected at launch volume = ≤50 writes/day. **`IMS_JOBS` namespace (Path A only):** ~74 writes/day average, burst ~524 writes/day. Combined under 1k/day cap. KV reads ~33k/day at 11k pageviews — under 100k cap. Build minutes <50/mo. Hard limits documented in §3.4 KV constraints; alerting via Cloudflare dashboard webhook. Upgrade to Workers Paid ($5/mo) lifts KV writes to 1M/day if a future feed scale ever requires it — still ≤$15/mo within Phase 1 cost envelope. |

---

## 6. Footer

**Footer is part of the dark exterior, NOT inside the cream card.** Matches PT footer language.

3-column layout on desktop (collapses to single-column mobile):

| EXPLORE | FOLLOW | CONTACT |
|---|---|---|
| For Clinicians | LinkedIn (only if Zach provides URL by launch) | recruiting@iastaffing.com |
| For Facilities | | 512-524-6686 |
| About | | |
| How It Works | | |
| Open Opportunities | | |
| Contact | | |

If LinkedIn URL not provided by launch, the entire FOLLOW column is dropped (empty/placeholder social cards read worse than absent ones). Footer collapses to 2-column EXPLORE + CONTACT.

Headers in TAY Basal 16px uppercase, links in TAY Amaya 15px cream-on-dark.

Bottom row (full-width, hairline divider above):
- Left: `© 2026 INNOVATIVE MEDICAL STAFFING` — TAY Basal mono 12px uppercase
- Right: `PRIVACY POLICY` · `COOKIES` · `TERMS & CONDITIONS` — TAY Basal mono 12px uppercase

**Schema.org JSON-LD** in BaseLayout `<head>`: Organization markup with name, url, logo, contactPoint (recruiting@ + phone), sameAs (LinkedIn URL when locked).

**Legal pages** (`/privacy`, `/cookies`, `/terms`): boilerplate Astro routes at `src/pages/privacy.astro`, `src/pages/cookies.astro`, `src/pages/terms.astro` (flat, not under `/legal/*` — clean URLs). Content drafted from standard healthcare-staffing templates + Zach review before launch. Privacy + cookie stance per §0.5.8.

---

### Map on /contact: dropped from Phase 1

Earlier draft language implied a map on `/contact`. Dropped from Phase 1 scope: a real Mapbox embed needs `mapbox.com` allowances in `script-src`, `style-src`, `connect-src`, and `worker-src` that the §0.5.3 CSP does not include, plus a Mapbox account ($5/mo entry tier above free quota) and public token. Not worth the surface area for an editorial contact page; a postal-style address block carries the same affordance. If a map is desired in 1.5, the approach will be a static-map image (Mapbox static-image API → cached PNG in `public/`, no client JS), which keeps CSP simple. **`img-src` `mapbox.com` allowance in §0.5.3 CSP is therefore unnecessary at Phase 1 and removed below.**

---

## 7. Out of scope (explicit non-goals at Phase 1)

- `/resources` or `/blog` (empty blog reads abandoned; opens at Phase 1.9 when 5-10 real posts queued)
- Locum income calculator (defer to Phase 1.9 with rate-sim-track validated data)
- Clinician portal / authenticated experience (separate product; dashboard migration is Phase 3+ backlog)
- A/B testing harness (Plausible goals are sufficient; defer Optimize-style infra)
- Internationalization (US-only)
- Live-chat widget (concierge brand promise = human reply, not bot — explicitly forbidden)
- Email marketing automation (Resend transactional only; Mailchimp/SendGrid/etc deferred)
- Custom illustration commission (Phase 1.5 budget item)
- Joint Commission HCSS cert pursuit (Phase 1.9 Zach decision, 6-12mo lead time)
- ATS integration (Phase 1.9 when volume justifies)

---

## 8. Success metric

**Phase 1.A LAUNCH gate (binary, day-of-deploy):** all 12 technical hard checks + 5 process soft gates in §5 Phase 1.A pass. Site is indexable.

**Phase 1.A post-launch validation (within 7 days, NOT a launch gate):** Lighthouse ≥95 site-wide on 5 sampled pages re-verified after live deploy. Plausible records ≥1 each of `cta_find_opportunities`, `cta_request_coverage`, `application_submitted`, `contact_form_submitted` within 7 days. Voice-lint advisory output reviewed at PR-time and re-evaluated for promotion to blocking.

**Phase 1.5:** ≥1 application/week through the apply form. ≥3 unique organic search referrals/week per Plausible.

**Phase 1.75:** ≥6 of 12 `/specialties/[slug]` pages indexed in Google. ≥10% of `/jobs` traffic arrives from a `/specialties/[slug]` referrer.

---

## 9. Decisions log

Decisions taken as designer's calls per Zach's autonomy delegation 2026-05-06. Push back during spec review if any are wrong.

| # | Decision | Rationale |
|---|---|---|
| 1 | PT-aesthetic visual direction | Zach's explicit direction 2026-05-06; brief's "boutique editorial" language fits PT pattern better than Apple-Garamond direction |
| 2 | TAY Basal (display) + TAY Amaya (body) | Zach's font picks; EULA cleared (Webfont Use, IMS <50 employees) |
| 3 | Logo stays at original `#59BFE7` sky blue | PT context (cream card + illustration + warm taupe) defangs brief §20 "generic medical blue" warning |
| 4 | Section 2.5 is the only inverse (dark) homepage section | Reading rhythm; matches PT's contrast cadence (cream-cream-dark-cream) |
| 5 | Filter rail UX on `/jobs` (left rail, not top dropdown) | Editorial-list reading vs SaaS-marketplace reading |
| 6 | Apply through IMS = single-step modal, NOT multi-step wizard | Concierge brand promise = first-touch is human, not gamified flow |
| 7 | No facility logos on `/jobs` cards | Endorsement risk + locked from prior brainstorm; Zach can revisit post-launch |
| 8 | Phased D job-board (1.A grid → 1.5 detail+search → 1.75 SEO) | Honors LocumSmart investment + ship velocity |
| 9 | Voice + visual lint advisory at v1, blocking at 1.5 | Zach unfamiliar with concept; let it warn first, graduate after seeing output |
| 10 | Custom illustration commission deferred to Phase 1.5 | Phase 1.A uses open-source library + palette recolor for ship velocity |
| 11 | Plausible Cloud over self-hosted | Setup velocity; $9/mo is rounding error |
| 12 | Cloudflare Access for Phase 3+ dashboard auth gate | Zero-code, free tier, allowlist on `@iastaffing.com` |
| 13 | **CV upload deferred to Phase 1.5** (was 1.A) | Codex round-1 NO-GO fold — Phase 1.A apply form is contact-only; recruiter requests CV in reply email. Eliminates malware-scan + Storage RLS + signed-URL flow from launch scope. |
| 14 | **Astro adapter: `@astrojs/cloudflare` hybrid output** | Codex NO-GO fold — marketing pages SSG, dynamic routes opt into SSR via `prerender = false`. |
| 15 | **LocumSmart pipeline cron via Scheduled Worker, not Pages Cron** | Codex NO-GO fold — Pages Functions don't have native cron; Worker writes KV, Pages reads. Free tier covers expected volume. |
| 16 | **CSP rewritten** (final block in §0.5.3) | Codex NO-GO fold — existing `default-src 'none'` + missing `font-src` blocks self-hosted fonts, Plausible, Turnstile. |
| 17 | **Schema.org JobPosting ships in Phase 1.5 alongside `/jobs/[id]`, NOT 1.75** | Codex AMBER fold — detail pages should not be indexed without structured data. |
| 18 | **`/jobs?...filtered` set `noindex,follow`** + canonical to `/jobs` | Codex AMBER fold — duplicate-content risk for SEO. |
| 19 | **MDX dropped from Phase 1** | Codex AMBER fold — Resources/blog (where MDX would land) is Phase 1.9; voice-lint glob is `.astro` + `.md` only. |
| 20 | **Voice lint advisory at v1, NOT a launch gate** | Codex AMBER fold — was contradiction (advisory in §4.5 but gate in §5). Resolved: advisory only, PR-time copy review is the actual gate. |
| 21 | **Fonts at `public/fonts/` (not `src/assets/fonts/`)** | Codex AMBER fold — `@font-face url('/fonts/...')` requires Astro public-dir for direct serve. |
| 22 | **Legal pages flat at `/privacy`, `/cookies`, `/terms`** (not `/legal/*`) | Codex NIT fold — clean URLs match nav links. |
| 23 | **Display-font fallback = Inter Variable 700-900**, not weight-synthesis | Codex AMBER fold — synthesis on single regular weight unreliable; Inter Variable is hosted by `@fontsource-variable/inter` for clean fallback. |
| 24 | **Apply-form goal-fire validation moved post-launch** (was launch gate) | Codex NIT fold — can't validate "≥1 of each goal within 7 days" at moment of launch. |

---

## 10. Open items / Zach action queue

These don't block spec approval but block specific deploy gates:

1. **🚨 LAUNCH gate (Phase 1.A):** DNSSEC DS record at Namecheap (Key Tag 2371, Algo 13, Digest Type 2, Digest `E87E0FAA4A721D1DB10ECD41DE219002F4988B65DF61D51C65C93074C3E951E3`)
2. **🚨 LAUNCH gate:** leadership names + roles + headshots → `/about` page (or green-light placeholder cards)
3. **🚨 LocumSmart admin authorization (decision deadline 2026-05-13)** — written OK to scrape or pull LS feed. **Plan-writing proceeds against Path B regardless** (per §3.4 default-Path-B rule). If LS authorization lands by 2026-05-13, Path A is folded into Phase 1.A as a scope-add (separate task track). If not granted by 2026-05-13, Phase 1.A ships Path B-only and Path A migration moves to Phase 1.5.
4. **Top-12 specialty list confirm:** Anesthesiology · CRNA · Hospitalist · Emergency Medicine · Family Medicine · Psychiatry · OB/GYN · General Surgery · Radiology · Pediatrics · Cardiology · Neurology — drop any IMS can't credibly staff, silence = ship
5. **Legal page content:** privacy / cookies / terms drafted from healthcare-staffing templates, Zach review before launch
6. **LinkedIn URL** for footer FOLLOW column (Instagram + Facebook out of scope at launch — empty social accounts read worse than absent ones)
7. **Resend domain verification** for `iastaffing.com` (SPF + DKIM + DMARC records at Namecheap DNS); without this the apply/contact form emails will land in spam.
8. **Supabase project** confirmation: spec assumes existing `gbakzhibzotugfyktcrt` project from rate-sim track; if Zach wants a separate IMS project, env var `SUPABASE_URL` swaps and tables go in the new project.
9. **WCAG contrast audit decisions** for the §5 Phase 1.A check #11 — failing pairs need approved variants (e.g., navy underline on cream might need to thicken/darken if `#1A2B4A` on `#F2E8DC` fails as 1px). Will be a Phase 1.0 task, not blocking spec approval.
