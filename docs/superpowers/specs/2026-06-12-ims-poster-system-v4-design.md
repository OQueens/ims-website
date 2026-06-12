# IMS Poster System (V4) — full-site design overhaul

**Date:** 2026-06-12
**Status:** Approved direction (Zach delegated remaining calls; "redesign inside Astro,
leave no stone unturned, cut no corners, leave the hub untouched, everything gets the
full treatment").
**Benchmark:** https://chromia.com — match its craft ceiling and beat it, while reading
premium healthcare-concierge rather than crypto-playful.

---

## 1. Locked decisions (from Zach, this session)

| Decision | Answer |
| --- | --- |
| Stack | Redesign **inside Astro**. No React/Vite rewrite. Backend (contact API, Turnstile, LocumSmart webhook, SSR job feed, middleware) untouched. |
| Hub | **Untouched.** HubLayout imports `colors_and_type.css` + `kit.css` + `palette-active.css` + `hub.css` — therefore the old CSS files stay in place and the new system ships as **new files**. |
| Scope | **Every page**, including job-board cards and legal pages. No page left on the old system. |
| Photography | **No-photo art direction.** Typography, texture, gradient, abstract shapes carry everything. No stock humans. |
| Type | **GT America is the brand.** Standard Black = display ("B — Swiss poster" chosen over Fraunces). Standard Medium/Regular = UI/body. GT America Mono = eyebrows, data chips, dates. Fraunces/Inter/Battlefin/JetBrains retire from marketing pages (fontsource imports stay installed for the hub cascade only — hub.css does not use them, but do not uninstall packages without checking hub). |
| Closing band | Zach rejected flat sky and flat navy. Resolution (my call, Chromia-informed): **morning-sky gradient field** (#9FD4EC → #5FB8E0 → #45B0DC) with ink wordmark + dark footer card. |
| Iteration model | Build it whole, then go back through section by section together. |

## 2. Chromia teardown — the mechanics we're stealing (measured 2026-06-12)

Source: live instrumentation (scroll-sampler at 400px steps), CSS download, DOM probes.

1. **One morphing surface.** Sections are transparent. `<main>` paints a dark color
   whose **alpha** is scroll-linked 0→1 entering dark bands (measured: α 0.2→1.0
   across ~1,200px of scroll). Body stays cream underneath. The dot grid swaps
   ink-on-cream ↔ accent-on-dark across the same threshold.
2. **Kinetic wordmark.** A ~3,250px-wide sticky headline translates -9% → -98%
   linearly across ~3,600px of scroll (≈ -0.0275%/px). Sticker-pill rows ride the
   same map at ~3.5× rate. Giant cream letters on the dark band.
3. **Expanding panels.** Use-case panels rest at `scale(0.75)` and scale to 1.0 on
   scroll-into-view (measured 0.75 → 0.79 → 0.92 → ~0.96 across entry).
4. **Light-up reveal.** Statements light word-by-word from pale gray to ink, scrubbed
   by scroll progress (screenshot captured mid-state: lit lines above, pale below).
5. **Roadmap.** Horizontal strip translated via `translate3d` (measured -12,906px),
   nodes = filled-check (done) vs glowing ring (next), mono pill dates, connector line.
6. **Close.** Full lavender field (`rgba(163,116,192)`), dot grid continues, giant ink
   wordmark slides, rotating circular badge, dark `rounded-[24px]` footer card floats on it.
7. **Engine truth:** Lenis 1.3.3 + JS inline styles. **Only 3 CSS keyframes in the
   entire site** (marquee `translate(-50%)` 10s linear, spin, pulse). Hovers are plain
   0.3s `cubic-bezier(.4,0,.2,1)` transitions. Nav = dark pill `rounded-full` header,
   promo pill above it swaps messages via translateY. Right-edge floating social rail.
8. **Tokens:** radii 12/20/36/72px; dark plum scale #17111b/#1f1a23/#292529; creams
   #f8f1f2/#fff8f8/#f5eeee; candy accents (pink/red/purple/green/yellow/orange).

**Where we beat them:** finer typographic detail (mono micro-layer), real data in the
floating artifacts (live job counts, real KPI chips vs. their memes), calmer easing,
disciplined 1-accent palette, and a coherent color **journey** (their bands feel
episodic; ours tells one warm→deep→dawn story).

## 3. Design system

### 3.1 Type — GT America (trial on staging; license gate before prod)

- **Display:** GT America **Standard Black** (+ Black Italic available). Hero words
  11–15vw, line-height 0.88–0.96, letter-spacing -0.03em, near edge-to-edge.
- **UI:** Standard Medium (pills, nav, buttons, labels). **Body:** Standard Regular,
  15–17px, 1.55 line-height. Strong size jumps between display and body.
- **Micro/data:** GT America **Mono** Regular — eyebrows (uppercase, tracked .12em),
  stat chips, timeline dates, job-card meta. This layer is our signature texture.
- Files: convert the trial OTFs (Standard Black/Medium/Regular + Mono Regular; add
  italics only if used) to woff2, self-host under `public/fonts/gt-america/` with a
  `LICENSE-NOTE.md` stating trial status. Preload display + body weights. CSP
  font-src 'self' already in place.
- **🔴 PROD GATE:** GT America trial license does NOT permit production publishing.
  Before any prod cherry-pick, Zach buys a GT America web license (Grilli Type,
  priced by pageviews) and we swap in licensed files. Staging is passcode-gated
  exploration use.
- Fallback stack: `'GT America', 'Helvetica Neue', Arial, sans-serif` with
  `size-adjust`-tuned local fallback @font-face to kill CLS.

### 3.2 Color — cream / slate-navy / sky (+ muted tints)

```
--paper:        #F6F1EA   (dominant canvas, warm)
--paper-bright: #FBF8F1
--ink:          #0C1C30   (text on cream; near-black navy)
--slate-900:    #15242F   (immersive dark band)
--slate-800:    #182A38   (dark band gradient partner)
--sky:          #45B0DC   (THE accent: CTAs, links, lit words, glow)
--sky-deep:     #2E8BC0   (hover/pressed)
--muted-warm:   #6B6253   (pre-reveal text on cream)
--on-dark:      #F6F1EA;  --on-dark-muted: #8FA3B2
--pre-reveal-dark: rgba(246,241,234,.28)  (pre-reveal text on slate)
--tint-sky:     #BFE3F2;  --tint-sand: #EBD9B8;  --tint-sage: #BFD8C4   (stickers ONLY)
--dawn-1: #9FD4EC; --dawn-2: #5FB8E0   (closing field gradient, with --sky)
```

Discipline: sky is the only saturated accent. Tints appear only on sticker pills and
roadmap date chips. Never rainbow.

### 3.3 Texture & chrome

- **Dot grid everywhere:** `radial-gradient` dots, 22px cell. Ink @ ~9% on cream;
  sky @ ~13% on slate; ink @ ~10% on the dawn field. Fixed-attachment so the surface
  feels continuous under the morph (mobile: scroll-attached for perf).
- **Radii language:** pills `999px`; cards 18–26px; hero panels/footer card 24–36px;
  specialty panels up to 36px at rest, easing to 18px at full scale.
- **Floating nav:** centered rounded-full pill bar, fixed, floats over content.
  Dark pill (ink bg, cream text) over cream; over dark bands it swaps to
  outlined-cream via the same `is-dark` observer that drives the surface morph.
  Contains: logo mark, 5 links, "Start a conversation" pill. Hide-on-scroll-down,
  reveal-on-scroll-up (existing behavior, rebuilt).
- **Promo pill** above nav (slim): rotates 2 messages by translateY swap:
  "47 states · credentialing typically under 60 days" / "A real human answers,
  weekends included". Dismissible.
- **Contact rail:** vertical rounded pill fixed right edge (desktop only): phone,
  email, back-to-top chevron. Our analog of Chromia's social rail.
- **Cloaked staff login** dot (top-left) is load-bearing — keep exactly as-is.

### 3.4 Motion system

- **Engine:** Lenis (^1.3) + one custom TypeScript module (`src/lib/motion/`):
  a single rAF loop reading `scrollY` once per frame, driving registered
  "scroll maps" (element + property + [scrollStart, scrollEnd] → [from, to] +
  easing). Powers: surface alpha morph, kinetic wordmark translateX, panel scale,
  light-up word color scrub, parallax stickers, roadmap glow progression,
  count-up triggers, nav adapt. **No GSAP, no React** — mirrors what Chromia
  actually ships; smallest bundle; full control.
- **Enter-once reveals:** keep/extend the existing IntersectionObserver cascade
  (`.reveal-group` stagger 0/80/160ms) — it already works and is CSP-inlined.
- **Hover/micro:** CSS transitions 0.3s `cubic-bezier(.4,0,.2,1)`. Magnetic
  buttons (pointermove ±6px translate, spring-back) on primary CTAs, desktop only.
- **Marquees:** pure CSS `translate(-50%)` loops (trust ticker; pillar ticker).
- **Reduced motion:** `prefers-reduced-motion` ⇒ no Lenis, no scroll maps, no
  magnetic, no marquee autoplay; everything resolves to final state with simple
  fades. The existing never-invisible failsafe pattern stays mandatory: content
  must NEVER depend on JS to be readable.
- **Performance budget:** transform/opacity/color only on the hot path; no layout
  thrash (all reads in one rAF batch); 60fps target; total new JS ≤ ~18KB gz
  (Lenis ~9KB + engine ~6KB); LCP = hero headline (font preloaded); CLS ≈ 0 via
  size-adjusted fallbacks.

## 4. The color journey (homepage)

```
cream ──────────────► slate ────► cream ────► slate ────► cream ──────► slate ───► dawn sky
Hero · Marquee · Stats │ PERSONAL │ The Way   │ Process  │ Specialties │ Voices  │ Close +
                       │ kinetic  │ compare   │ 3 steps  │ + Roadmap   │ (testi) │ footer card
```

Three slate bands + one dawn close. Each morph gets ≥60vh of breathing room
(Chromia's trick). Surface = body cream + one fixed overlay div whose background
and alpha are scroll-mapped; dot-grid layer swaps in the same map.

## 5. Homepage — section by section

Content rule: copy below is the prompt's content **passed through the standing copy
standards** (no em-dashes in body; "short list/present" not "send resumes";
"expedited credentialing/temporary privileges" preferred; no physician-founder
signals; nothing fabricated beyond what is already live today).

1. **HERO** (cream): mono eyebrow pill "Locum tenens · est. 2022". Display 12–15vw:
   "A More *Personal* Way to Staff Care." — rotating word (Personal → Curated →
   Thoughtful → Human) in sky, crossfade+rise, CSS-only fallback. Subhead. Pills
   [For Facilities →] [For Clinicians →]. Scroll chevron. Magnetic CTAs.
2. **TRUST MARQUEE** (cream): existing real-client list verbatim (CHS, Advocate,
   Atrium NC, Tenet, Ochsner, Northwest AZ, MountainView NM, LifePoint, Providence,
   USPI), "Trusted by leading U.S. health systems" eyebrow. CSS ticker, pauses on
   hover, GT Mono separator ✦.
3. **STAT BAND** (cream, morph begins at its tail): 47 States · 2022 Founded ·
   All Specialties · 1:1 Recruiter per clinician. Count-up on enter (47 counts,
   2022 counts, "All" and "1:1" flip in). Giant Black numerals, mono labels.
4. **§02 TWO AUDIENCES** (slate band 1, kinetic "PERSONAL" wordmark behind at
   Chromia's exact parallax math; sticker pills "One recruiter, for life" /
   "Three, not thirty" / "A real human answers" drifting at 3.5×):
   light-up statement "Most agencies write to a hypothetical everyone. We don't."
   Then two cards: **Facilities · 01** "Curated, not volume." with the existing
   live "Recently placed" stack (Jordan M./Kavi R./Sara P. — carried over from
   the live site, unchanged) + [Hire a clinician →]; **Clinicians · 02** "One
   recruiter, for life." with the live "Open this week" feed (real ims_jobs) +
   [Find your assignment →].
5. **§03 DIFFERENTIATION** (cream): "The way most aren't." Two-column ✕/✓ compare
   (existing 7 rows verbatim), rows reveal alternately from left/right; ✓ cells
   get sky ticks. One sticker pill cluster floats the margin: "Same name, every
   call" / "Replies within one business day". (Drop "No AI, just humans" sticker;
   the existing live "No AI" card copy stays as-is where it already lives.)
6. **§04 PROCESS** (slate band 2): "Three steps, nothing hidden." Three tall steps
   with animated artifacts: 01 mini form types itself (Specialty: Anesthesiology /
   Location: Austin, TX / Start: June 15 / Length: 12 weeks); 02 three candidate
   cards deal in (uses the same live-data card component as §02); 03 calendar
   chip lands on "First shift" + line "Credentialing typically under 60 days,
   with expedited options when a start can't wait."
7. **SPECIALTIES** (cream): "Where we live deepest." 8 expanding panels
   (scale .82→1 on entry, hover lift): giant mono Nº01–Nº08 + Black name +
   body + **live count from ims_jobs** + [Explore →] deep-link to /jobs?q=.
   Abstract per-specialty gradient art (slate→sky mixes, no photos).
8. **ROADMAP** (cream): "The journey, mapped." Horizontal glowing timeline,
   7 nodes (01 First conversation → 07 One recruiter, for life), check-filled
   vs glowing-ring nodes, mono pill markers (DAY 1 / WEEK 1 / ~DAY 60 …),
   click-to-expand detail. Connector glow advances with scroll. Drag/scroll-snap
   on mobile.
9. **§06 THREE RULES** (cream): "Three rules we won't break." The three existing
   value cards, light-up reveal on each title, sky keyword accents.
10. **TESTIMONIALS** (slate band 3): light-up quotes, facility vs clinician split
    (tab pills). Uses the **live shipped testimonial copy** (acd60a9 versions),
    NOT the prompt's em-dash variants.
11. **CONTACT** (cream): "Let's talk." Email/phone/founded cards + the existing
    ContactPanel form (Turnstile + /api/contact wiring preserved EXACTLY; only
    reskinned). "I am a…" [Facility] [Clinician] [Something else] pill selector.
12. **CLOSE + FOOTER** (dawn sky field): giant ink "LET'S TALK." wordmark sliding,
    rotating circular badge ("A REAL HUMAN ANSWERS · EST. 2022 ·"), dark footer
    card (24px radius) floating: logo, [Start a conversation →], columns
    (Facilities · Clinicians · Jobs · Contact · About), contact + legal row.

## 6. Sub-pages (same system, full treatment)

- **/facilities:** hero "A curated roster, not a job board." (existing live copy);
  roster snapshot cards (existing live fabricated-by-decision cards carried over);
  pillar CSS ticker; "What every partnership always includes" 01/02/03 panels
  (expanding-panel device, smaller scale); 3 facility testimonials (live copy);
  dawn close CTA. Slate band: the 01/02/03 panels.
- **/clinicians:** hero "From CV to first shift in four clear steps."; the 4 steps
  as a vertical glowing timeline (roadmap device rotated); "Why clinicians stay"
  four sticker-pill expanders; 3 clinician testimonials (live copy); close CTA
  [Submit your CV →] [See open jobs →].
- **/jobs:** the board reskinned: GT Mono meta, pill filters, card hover-lift +
  sky tick; search/fuzzy logic untouched. Cards: specialty tint hairline, Black
  title, mono location/dates/rate rows. Counts and data identical to today.
- **/jobs/[slug]:** SSR detail page reskinned to V4 (tone hero, dark apply rail
  becomes slate band with sky CTA; confetti stays); all data wiring untouched.
- **/about:** reskin with one slate band (mission statement light-up; founded-in-
  Fort-Worth fact block; stats reuse §03 band). No new claims, no team photos.
- **/specialties:** the 8 expanding panels, full-page version, live counts.
- **/how-it-works:** the roadmap device, full-page version + process artifacts.
- **/contact:** GetInTouch reskinned; form wiring + Turnstile untouched.
- **/terms /privacy /cookies:** typographic reskin only (V4 type/spacing/pills for
  TOC), LEGAL_CONTENT text untouched.
- **404 + any stragglers:** V4 type + dot grid.

## 7. Engineering plan

### 7.1 CSS architecture (hub isolation)

- NEW files: `src/styles/v4-tokens.css`, `v4-base.css`, `v4-components.css`,
  `v4-motion.css` (+ per-page scoped styles in .astro files).
- `MarketingLayout.astro` swaps its style imports to the V4 set + GT America
  @font-face. It keeps: canonical/OG/Plausible/JSON-LD/cloak-login/never-invisible
  failsafe (verify-build invariants).
- `colors_and_type.css`, `kit.css`, `palette-active.css` remain UNTOUCHED, imported
  only by HubLayout (+ BaseLayout/tokens.css if still referenced). Mark each with a
  "hub-only legacy, do not edit for marketing" header comment as the only change.
- Old fontsource imports move out of MarketingLayout; packages stay installed.

### 7.2 JS architecture

```
src/lib/motion/
  lenis-init.ts      (lazy, skipped on reduced-motion/mobile-optional)
  scroll-engine.ts   (rAF loop + map registry + is-dark threshold events)
  devices.ts         (wordmark, light-up, panels, count-up, parallax, rail, nav-adapt)
  magnetic.ts
```
Loaded as one deferred module from MarketingLayout; every device reads
`data-*` attributes so sections stay declarative Astro HTML. SSR pages remain
zero-JS-readable (motion is enhancement only).

### 7.3 Testing & verification

- Vitest: scroll-engine map math (pure functions), light-up splitter, count-up
  formatter, device registry, reduced-motion guards. Existing 241+ tests must
  stay green (forms/webhook/hub untouched proves it).
- `npm run verify` (build + voice-lint) green; voice-lint guards the no-em-dash rule.
- Playwright pass on local preview: every page desktop (1440) + mobile (390),
  console-error-free, key devices visually present at multiple scroll depths.
- Codex review loop per the standing session mandate (in-band, before "done").
- Deploy to `ims-staging.pages.dev` (existing staging project; gate ZY), then
  live-verify the same Playwright sweep + form fail-closed checks.

### 7.4 Branch & ship posture

- New branch off `hub-port` tip: `redesign/v4-poster`. Commits section-by-section
  (foundation → homepage → subpages → polish). NOT pushed to prod; prod cutover is
  a separate later decision gated on (a) Zach review, (b) GT America license.

## 8. Hard constraints (do-not-break list)

1. Hub: zero file changes under `src/pages/hub/`, `src/components/hub/`, `hub.css`,
   HubLayout, hub libs; legacy marketing CSS files untouched (hub depends on them).
2. `/api/*` endpoints, middleware redirects, Turnstile wiring, Supabase reads: untouched.
3. MarketingLayout SEO scaffolding (canonical, OG, Plausible-only telemetry rule,
   JSON-LD) preserved — the Plausible legal contract comment travels to V4.
4. Copy standards: no em-dashes in body copy; no physician-founder signals; no new
   fabricated data (existing live fabrications carry over per Zach's standing
   decision; flag-don't-remove).
5. Live data stays live: job counts, "Open this week", board, detail pages.
6. Never-invisible: all content readable with JS disabled/failed.
7. Accessibility: semantic landmarks, keyboard-reachable expanders/timeline,
   focus-visible styles, contrast ≥ 4.5:1 body / 3:1 large display, reduced-motion.
8. GT America trial fonts: staging only; `LICENSE-NOTE.md` + prod gate documented.

## 9. Out of scope (this arc)

- Prod deployment + GT America license purchase (separate gated step).
- Hub redesign (separate arc, already specced elsewhere).
- New testimonial/marquee content, site-wide avoid-list copy pass (offered before,
  still open — not blocked by this redesign).
- Job-board chatbot, GoFetchData leads page, INC-3 activation.
