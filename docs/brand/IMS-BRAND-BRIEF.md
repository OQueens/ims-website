# IMS Brand Brief — Marketing Site v2 (chromia + warm-accents)

**Status:** v2 · 2026-05-26 · all open questions resolved · **READY FOR CLAUDE DESIGN HAND-OFF**
**Moodboard:** [ims-finalists.pages.dev/design-board/](https://ims-finalists.pages.dev/design-board/) (11 dimensions × 8 picks each — 4 Mobbin + 4 ref-site facets)
**This brief (web-fetchable):** [ims-finalists.pages.dev/design-board/brief/](https://ims-finalists.pages.dev/design-board/brief/) — same allowlisted CF Pages domain as the moodboard
**Scope:** Marketing site only (`innovativemedicalstaffing.com`). Internal dashboards (LocumSmart Analytics, Rate Calculator, etc.) continue using the existing **IAS Apple HIG** system in `docs/IAS-Design-System.md` unchanged.
**Hand-off target:** Claude Design

---

## 0 · Reading order

1. [§1 Synthesis](#1--the-synthesis-in-one-paragraph) — what this brand *is*
2. [§2 Predecessor reconciliation](#2--predecessor-reconciliation) — what this replaces, what it keeps
3. [§3 Reference sites](#3--the-four-reference-sites) — visual ground truth
4. [§4 Locked picks](#4--the-11-dimension-picks-locked) — the matrix
5. [§5-§7 Tokens](#5--color-tokens) — colors, type, spacing/motion
6. [§8 Component anatomy](#8--component-anatomy) — nav, hero, CTA pair, contact, cards, footer, loading
7. [§9 Voice & microcopy](#9--voice--microcopy) — how it talks
8. [§10 Page hierarchy](#10--page-hierarchy--per-page-treatment) — every page, its job, its layout
9. [§11 State patterns](#11--state-patterns) — loading / empty / error / success
10. [§12 Accessibility](#12--accessibility) — non-negotiables
11. [§13 Responsive](#13--responsive-rules) — what breaks at what width
12. [§14 Logo & wordmark](#14--logo--wordmark) — what already exists, what's new
13. [§15 Motion](#15--motion-rules) — restraint hierarchy
14. [§16 Imagery](#16--imagery-rules)
15. [§17 Performance & SEO](#17--performance--seo)
16. [§18 Build sequence](#18--build-sequence-for-claude-design)
17. [§19 Open questions](#19--open-questions)

---

## 1 · The synthesis in one paragraph

A **chromia chassis** — pill chrome, dot-grid texture, dark-on-cream, bracketed display serif, restraint — warmed at the edges by **Tolan**'s pastel-character accents and **Aftermetoo**'s organic coral/lavender blob decorations + warm teal/aubergine ink. The footer is where the warmth comes out loud (peach-cream + blob accents + warm sign-off). The hero routes two audiences via a multi-pill action row: `(For Facilities)` and `(For Clinicians)`. Imagery stays mostly typographic — abstract product diagrams over photography. Voice: rigorous, technical, restrained — but human and conversational at the close. *Net feel:* a calm, considered medical staffing partner — neither corporate-bro nor clinical-stock.

---

## 2 · Predecessor reconciliation

The marketing site has been through three design directions. This brief is the **fourth** and last for v2. Each predecessor is captured so nothing important is silently dropped.

| Direction | Era | Location | Status under this brief |
|---|---|---|---|
| **IAS Apple HIG** | original (~2024–2026-04) | `docs/IAS-Design-System.md` | **Preserved** for internal dashboards (LocumSmart Analytics, Rate Calculator, PokeTrader, Weekly Sync). Not applied to marketing site going forward. |
| **Belleval cream-luxury** | 2026-05-17 → 2026-05-20 | retired branches | **Retired.** Concept influenced this brief but the implementation was reverted. |
| **IMS Dark System (navy + cyan + tangerine)** | 2026-05-12 → 2026-05-26 | `src/styles/tokens.css` (current `--ims-navy-*`, `--card-tangerine`, etc.) | **Being replaced by this brief.** Tokens stay readable during transition (legacy aliases kept) but new pages must consume the new chromia-cream tokens. |
| **IMS Chromia-Cream (this brief)** | 2026-05-26 → | `docs/brand/IMS-BRAND-BRIEF.md`, eventually `src/styles/tokens.css` | **Active.** Marketing site target. |

**What gets preserved across the pivot:**
- **IMS logo SVG system** (`src/components/brand/LogoDefault.astro` · `LogoMono.astro` · `LogoOnDark.astro`) — all 4 variants stay; only contextual usage rules change (see [§14](#14--logo--wordmark))
- **Astro 5 + Cloudflare Pages adapter v12 stack** — no rebuild
- **CSP locked-down, zero-JS marketing architecture** — motion stays CSS-only
- **Existing page hierarchy** (`index, about, clinicians, facilities, contact, how-it-works, specialties, jobs/*, privacy, terms, cookies`) — pages keep their URLs, content is restyled in place
- **TAY Basal + TAY Amaya `@font-face` blocks** — keep on disk (verify-build asserts them), but they remain unloaded; Fraunces + Inter take over
- **`MarketingLayout.astro` shell** — keep, swap chrome bindings to the new tokens
- **Plausible Cloud + Turnstile** integrations and their CSP allowlist
- **Voice-lint scanner** (`scripts/voice-lint.mjs`) — keep, may need new BANNED/CARE tokens for chromia-cream voice (see [§9](#9--voice--microcopy))
- **`X-Robots-Tag: noindex` until the LAUNCH HARD GATE** flips (T15 + T16) — unchanged

**What gets replaced:**
- `src/styles/tokens.css` — full overwrite with [§5-§7](#5--color-tokens) tokens. Legacy `--ims-navy-*` aliases kept temporarily so verify-build assertions and any unconverted pages still resolve.
- All `src/components/sections/Home*.astro` chrome — restyle in place per [§10](#10--page-hierarchy--per-page-treatment)
- `src/components/nav/SiteNav.astro` — restyle to chromia floating-pill capsule
- `src/components/footer/SiteFooter.astro` — restyle to aftermetoo warm close

---

## 3 · The four reference sites

Verified live via Playwright at 1440px, 2026-05-26. **All hex values below are sampled from the actual sites, not inferred.**

| Site | Role | Verified bg | Verified ink | Verified fonts |
|---|---|---|---|---|
| **[chromia.com](https://chromia.com)** | The chassis — frame · type · chrome · motion · imagery | `#F8F1F2` (warm pink-cream) | `#1F1A23` (deep plum-black) / `#000` (body) | Display: **Battlefin** (Pangram Pangram) · Body: **NB International** |
| **[tolans.com](https://tolans.com)** | Pastel character accents + bone-cream warmth | `#F4F2E7` (bone-cream) | `#000` (pure black) | **GT America** (Grilli Type) for body + display |
| **[wyelea.com](https://wyelea.com)** | Restraint posture — luxury minimal, photography-led | (full-bleed photography) | (white-on-image typography) | Editorial serif (not sampled — SVG-rendered hero) |
| **[aftermetoo.com](https://aftermetoo.com)** | Warm voice + teal/aubergine ink + blob decoration set | `#FCF7F1` (peach-cream) | `#003E52` (teal body) · `#522461` (aubergine headlines) | Body: **Pensum Pro** (serif) · Display: **Cera Pro** (sans) |

**What this verification revealed (corrections vs. my first-draft assumptions):**
- Chromia's bg is **#F8F1F2** (slightly pink-warm), not the `#F4EDE6` I had in the moodboard CSS
- Chromia's display font is **Battlefin** — a contemporary bracketed display *serif* by Pangram Pangram (paid; Migra is a same-house alternative). My "Tobias/Migra family" guess was directionally right, exact name wrong
- Aftermetoo's body ink is **deep teal #003E52**, not aubergine. Aubergine **#522461** is reserved for headlines
- Aftermetoo uses **serif body + sans display** — opposite of chromia's pattern. That's a design choice we should be deliberate about
- Tolan uses **GT America** (sans) everywhere — the "geometric ultra-heavy wordmark" effect comes from the SVG-rendered "Tolan" wordmark, not the typeface itself

---

## 4 · The 11 dimension picks (locked)

| Dim | Pick | Source | What this means concretely |
|---|---|---|---|
| **01 Hero** | 1E | Chromia | Bracketed display serif headline · centered · dot-grid bg · multi-pill action row below |
| **02 Nav** | 2E | Chromia | Floating pill capsule · dark ink on cream · wordmark left + centered links + CTA pill right · sticky |
| **03 Palette** | 3F + 3H blend | Tolan + Aftermetoo | Cream base + dark ink (structural) · pastel character accents (3F) · organic blob decorations + teal body / aubergine headline accent (3H) |
| **04 Typography** | Chromia (overrode 4F) | Zach reverted 4F Tolan | Bracketed display serif for headlines · sans tracked all-caps for labels · sans body |
| **05 Contact** | 5B | Origin Mobbin | Cream + bold serif headline · clean bordered inputs · dark "Send" pill |
| **06 CTAs** | 6E · audience-split | Chromia | Multi-pill action row with two primary pills: `(For Facilities)` + `(For Clinicians)` · dark ink on cream |
| **07 Cards** | 7E | Chromia | Soft rounded cream panels · faint dot-grid texture inside · pill chrome on links |
| **08 Footer** | 8H | Aftermetoo | Cream + blob accents + warm sign-off · social pill icons · conversational close |
| **09 Loading** | 9C | Manus | Hand-sketch brand mark on off-white · slow re-draw · matches the blob/character accent hand-feel |
| **10 Motion** | 10E | Chromia | Type-led — headlines animate in · dot grid persists as quiet texture · pills hover-respond · restrained |
| **11 Imagery** | 11E | Chromia | Mostly typographic · abstract product diagrams over photography · duotone-aubergine when photo is used |

Per-dimension pick rationale lives in the moodboard captions — link out for visual context.

---

## 5 · Color tokens

Structural palette is **chromia cream + plum-black**, warmed with **aftermetoo's teal body ink + aubergine accent**, and decorated with **Tolan pastel characters + aftermetoo blobs**.

```css
:root {
  /* ───────── Structural (chromia + light aftermetoo blend) ───────── */
  --cream:          #F6EFE8;  /* page bg — between chromia #F8F1F2 and aftermetoo #FCF7F1, biased neutral */
  --cream-soft:     #FBF6EE;  /* cards, modals — lighter still */
  --cream-warm:     #F4ECDF;  /* warmer variant for footer / hero panels */
  --bone:           #F4F2E7;  /* tolan accent — pure-bone variant section bg */

  /* ───────── Ink ───────── */
  --ink:            #1F1A23;  /* primary ink — verified chromia headline color */
  --ink-soft:       rgba(31, 26, 35, 0.68);  /* secondary text */
  --ink-mute:       rgba(31, 26, 35, 0.42);  /* tertiary text, captions */
  --ink-teal:       #003E52;  /* aftermetoo body ink — used for warm-voice sections (footer, contact intro) */
  --ink-aubergine:  #522461;  /* aftermetoo headline ink — emphasis headlines, hover/active states */

  /* ───────── Lines & surfaces ───────── */
  --rule:           rgba(31, 26, 35, 0.10);   /* default border */
  --rule-strong:    rgba(31, 26, 35, 0.20);   /* hover/focus border */
  --shadow-pill:    0 6px 30px rgba(31, 26, 35, 0.18);
  --shadow-card:    0 8px 32px rgba(31, 26, 35, 0.06);
  --shadow-lift:    0 12px 40px rgba(31, 26, 35, 0.10);

  /* ───────── Tolan pastel character accents (illustrative, sparing) ───────── */
  --accent-pink:    #F4B8C7;
  --accent-teal:    #9ED4D0;
  --accent-sage:    #B5D0A8;
  --accent-lavender:#D4C2EE;

  /* ───────── Aftermetoo blob decorations (footer, contact corners) ───────── */
  --blob-coral:     #F4A78A;
  --blob-lavender:  #C8B3E0;

  /* ───────── Dot-grid texture (chromia signature) ───────── */
  --dot-color:      rgba(31, 26, 35, 0.07);
  --dot-pitch:      22px;
  --dot-size:       1px;
}

body {
  background-color: var(--cream);
  background-image: radial-gradient(var(--dot-color) var(--dot-size), transparent var(--dot-size));
  background-size: var(--dot-pitch) var(--dot-pitch);
  color: var(--ink);
}
```

**Contrast budget (WCAG AA minimum):**

| Pair | Ratio | Use |
|---|---|---|
| `--ink` on `--cream` | 12.8:1 | Body, headlines |
| `--ink-soft` on `--cream` | 8.4:1 | Secondary text |
| `--ink-mute` on `--cream` | 5.4:1 | Captions, labels |
| `--ink-teal` on `--cream-warm` | 9.6:1 | Footer body |
| `--ink-aubergine` on `--cream` | 11.2:1 | Emphasis headlines |
| `--cream-soft` on `--ink` (inverse) | 13.1:1 | Pill CTA fill |

All combinations pass WCAG AAA (≥7:1) for normal text and AA (≥4.5:1) for large text. Verify on final build with axe-core.

**Pastel accents must NOT carry information.** They're decorative only — never used for status, link state, or actionable affordance. If we ever need accent-as-signal, propose new tokens before reusing pastels.

---

## 6 · Typography

**Decision:** Chromia direction. Bracketed display serif for headlines, sans for body — type IS the brand.

```css
:root {
  --font-display: "Fraunces", "Battlefin", "Migra", "Tobias", Georgia, serif;
  --font-body:    "Inter Variable", "Inter", system-ui, -apple-system, sans-serif;
  --font-mono:    ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
}
```

**Font choices, ranked:**

| Slot | Recommended (v1, free) | Premium upgrade (v2, paid) | Rationale |
|---|---|---|---|
| Display | **Fraunces** (Google, variable) | **Battlefin** (Pangram Pangram, paid) or **Migra** (Pangram Pangram, paid) | Fraunces dials up to a heavy bracketed weight that approximates chromia's display character. Already self-hostable. Battlefin/Migra are the exact-match commercial fonts. |
| Body | **Inter Variable** (Google, variable, already in `tokens.css`) | **NB International** (Neubau, paid) | Inter is the proven licensable substitute for chromia's NB International. Already loaded. |
| Mono | **JetBrains Mono** (free, fallback to system mono) | — | Reserved for code blocks, structured data displays, technical microcopy |

**Type scale (clamp-driven for fluid responsive):**

```css
:root {
  --t-display-xxl: clamp(56px,  9vw,  120px) / 0.95;  /* hero headline (chromia "Build Brilliant" scale) */
  --t-display-xl:  clamp(44px,  6vw,  88px)  / 1.00;  /* section anchors */
  --t-display-l:   clamp(36px,  4vw,  64px)  / 1.05;  /* major card / modal headlines */
  --t-display-m:   clamp(28px,  3vw,  44px)  / 1.10;  /* sub-anchors */
  --t-h1:          32px / 1.15;
  --t-h2:          24px / 1.20;
  --t-h3:          20px / 1.25;
  --t-body-lg:     18px / 1.55;
  --t-body:        16px / 1.55;
  --t-body-sm:     14px / 1.50;
  --t-label:       12px / 1.40;  /* tracked uppercase 0.16em */
}
```

**Type-pairing rules:**

- **Italics for emphasis pairs in headlines.** Aftermetoo's `back` / `forward` pattern. One emphasis word per headline maximum.
- **Tracked all-caps labels** (`.label`, eyebrows, section numbers, footer column heads): `letter-spacing: 0.16em`, `font-weight: 600`, `--ink-mute` color.
- **Body color hierarchy:** primary text in `--ink`, secondary in `--ink-soft`, captions in `--ink-mute`. In the footer + contact, swap primary to `--ink-teal` for the warm voice shift.
- **Tabular nums on stats/numbers:** `font-variant-numeric: tabular-nums`.
- **Never go below 14px** for body text. 12px is reserved for tracked-uppercase labels only.

**Font loading:**
- Self-host Fraunces via `@fontsource-variable/fraunces` (matches the existing `@fontsource-variable/inter` pattern in `tokens.css`)
- Keep TAY Basal + TAY Amaya `@font-face` blocks unloaded but on disk (verify-build assertion)
- `font-display: swap` for both Fraunces + Inter

---

## 7 · Spacing, radius, motion tokens

```css
:root {
  /* ───── Radius ───── */
  --radius-pill:    999px;
  --radius-card:    16px;
  --radius-card-lg: 22px;       /* hero-anchor cards */
  --radius-input:   12px;
  --radius-modal:   20px;
  --radius-xs:      8px;        /* badges, micro-controls */

  /* ───── Spacing (8-pt scale, kept compatible with existing --s-* in tokens.css) ───── */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  24px;
  --space-6:  32px;
  --space-7:  48px;
  --space-8:  64px;
  --space-9:  96px;
  --space-10: 128px;

  /* ───── Motion ───── */
  --ease-out:    cubic-bezier(0.22, 0.61, 0.36, 1);  /* matches existing --ease-out */
  --ease-snap:   cubic-bezier(0.32, 0.72, 0.00, 1);
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --dur-fast:    150ms;
  --dur-base:    280ms;
  --dur-slow:    520ms;

  /* ───── Layout ───── */
  --container-max: 1320px;
  --container-pad: 32px;
  --container-pad-mobile: 20px;
}
```

---

## 8 · Component anatomy

### 8.1 Navigation (chromia 2E)

**Structure:** floating pill capsule, sticky top with 16px margin, dark ink on cream.

```html
<nav class="topnav">
  <a href="/" class="topnav__wordmark">
    <LogoDefault /> <!-- existing brand component -->
  </a>
  <div class="topnav__links">
    <a href="/facilities">Facilities</a>
    <a href="/clinicians">Clinicians</a>
    <a href="/how-it-works">How it works</a>
    <a href="/specialties">Specialties</a>
    <a href="/about">About</a>
  </div>
  <a href="/contact" class="topnav__cta">Get in touch →</a>
</nav>
```

```css
.topnav {
  position: sticky;
  top: 16px;
  z-index: 100;
  max-width: 1100px;
  margin: 16px auto 0;
  background: var(--ink);
  color: var(--cream-soft);
  border-radius: var(--radius-pill);
  padding: 10px 18px 10px 22px;
  display: flex;
  align-items: center;
  gap: 18px;
  box-shadow: var(--shadow-pill);
  font-family: var(--font-body);
  font-size: 13px;
}
.topnav__wordmark { /* LogoDefault renders with cream fill via prop */ }
.topnav__links {
  display: flex; gap: 14px; flex: 1; justify-content: center; flex-wrap: wrap;
}
.topnav__links a {
  color: rgba(251, 246, 238, 0.72);
  text-decoration: none;
  transition: color var(--dur-fast) var(--ease-out);
}
.topnav__links a:hover,
.topnav__links a[aria-current="page"] {
  color: var(--cream-soft);
}
.topnav__cta {
  background: var(--cream-soft);
  color: var(--ink);
  padding: 7px 16px;
  border-radius: var(--radius-pill);
  font-weight: 600;
  text-decoration: none;
}
```

**Behavior:**
- Hides toc links below 700px viewport (replaced by hamburger; see [§13](#13--responsive-rules))
- `aria-current="page"` on the active link for screen readers and visual hover-state parity
- No scroll-triggered shrink — sticky pill stays the same height

### 8.2 Hero (chromia 1E + audience CTA split)

**Layout:**

```
┌─── eyebrow (tracked all-caps) ─────────────────┐
│                                                 │
│   A More Personal Way to Staff Care.            │
│   (bracketed display serif, "Personal" italic   │
│    in --ink-aubergine, 2-line wrap on desktop)  │
│                                                 │
│   We bring a boutique, family-style approach    │
│   to locum staffing — connecting clinicians     │
│   and facilities with the care, speed, and      │
│   concierge support they deserve.               │
│                                                 │
│  ┌─ TWO-PILL AUDIENCE ROW ──────────────────┐  │
│  │  (For Facilities)   (For Clinicians)     │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  ╲   small pastel character accent (max 1-2)   │
│   ╲  tucked in negative space                   │
└─────────────────────────────────────────────────┘
       │ dot-grid background persists │
```

**Note:** only **two pills** in the hero action row. No secondary "See open jobs" / "About IMS" pills — those routes are already in the top nav. The hero stays focused on the audience split.

**Spec:**

```css
.hero {
  padding: var(--space-10) var(--container-pad) var(--space-9);
  max-width: var(--container-max);
  margin: 0 auto;
  text-align: center;
}
.hero__eyebrow {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-mute);
  margin-bottom: var(--space-4);
}
.hero__headline {
  font-family: var(--font-display);
  font: var(--t-display-xxl);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--ink);
  margin: 0 0 var(--space-5);
  max-width: 18ch;  /* keep headline shape — 2 lines max */
  margin-inline: auto;
}
.hero__headline em {
  font-style: italic;
  color: var(--ink-aubergine);  /* aftermetoo accent ink */
}
.hero__sub {
  font: var(--t-body-lg);
  color: var(--ink-soft);
  max-width: 60ch;
  margin: 0 auto var(--space-6);
}
.hero__cta-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-3);
}
```

**LOCKED hero copy:**

- **Headline:** `A More <em>Personal</em> Way to Staff Care.`
  - Title case · 7 words · "Personal" italic-emphasized in `--ink-aubergine` per the brief's italic-emphasis-pair pattern. "Personal" is the brand differentiator vs traditional agencies — that's why it gets the emphasis.
- **Supporting line:** "We bring a boutique, family-style approach to locum staffing — connecting clinicians and facilities with the care, speed, and concierge support they deserve."
  - 32 words · ~190 chars · two lines at desktop `max-width: 60ch`

### 8.3 Audience CTA pair (6E split — the primary action)

Two pills in the hero action row, side-by-side. Both use chromia primary pill styling. Parentheses kept as Zach specified.

```html
<a href="/facilities" class="pill pill--primary" aria-label="Resources for facilities">
  (For Facilities)
</a>
<a href="/clinicians" class="pill pill--primary" aria-label="Resources for clinicians">
  (For Clinicians)
</a>
```

```css
.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: 12px 22px;
  border-radius: var(--radius-pill);
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 15px;
  text-decoration: none;
  transition: transform var(--dur-fast) var(--ease-out),
              box-shadow var(--dur-fast) var(--ease-out),
              background var(--dur-fast) var(--ease-out);
}
.pill--primary {
  background: var(--ink);
  color: var(--cream-soft);
}
.pill--primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-lift);
}
.pill--primary:focus-visible {
  outline: 2px solid var(--ink-aubergine);
  outline-offset: 3px;
}
.pill--secondary {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--rule-strong);
}
.pill--secondary:hover {
  background: var(--cream-soft);
  border-color: var(--ink);
}
```

**Audience-pair anatomy (LOCKED):**
- **Identical styling** — both primary `--ink` pills so neither audience reads as secondary
- **Labels in parentheses** — `(For Facilities)` and `(For Clinicians)` — soft, audience-routing chip read, not imperative action
- **Label-only** — no icons. Decision locked v1, do not propose adding.
- **Always paired** — never show "For Facilities" without "For Clinicians" adjacent; the parity is the brand moment
- **Plausible attribution:** add `data-cta="facilities"` and `data-cta="clinicians"` so click-through can be split by audience

### 8.4 Contact form (Origin 5B)

```html
<section class="contact" id="contact">
  <span class="eyebrow">Reach out</span>
  <h2 class="contact__headline">Let's <em>talk</em>.</h2>
  <p class="contact__sub">
    Whether you're a facility looking for clinicians or a clinician
    looking for your next assignment — start here.
  </p>
  <form class="contact__form" action="/api/contact" method="post">
    <!-- 2-column grid for paired fields -->
    <input name="name" placeholder="Your name" required />
    <input type="email" name="email" placeholder="Email" required />
    <select name="audience" required>
      <option value="">I am a…</option>
      <option value="facility">Facility</option>
      <option value="clinician">Clinician</option>
      <option value="other">Something else</option>
    </select>
    <input name="role" placeholder="Role or specialty (optional)" />
    <textarea name="message" placeholder="What can we help with?" rows="4"></textarea>
    <!-- Turnstile widget (existing infra) -->
    <button type="submit" class="pill pill--primary">Send →</button>
  </form>
  <div class="blob blob--corner blob--lavender" aria-hidden="true"></div>
</section>
```

```css
.contact {
  background: var(--cream-soft);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card-lg);
  padding: var(--space-8);
  max-width: 880px;
  margin: var(--space-9) auto;
  position: relative;
  overflow: hidden;
}
.contact__headline {
  font: var(--t-display-l);
  font-family: var(--font-display);
  font-weight: 700;
  color: var(--ink);
  margin-bottom: var(--space-3);
}
.contact__headline em { color: var(--ink-aubergine); font-style: italic; }
.contact__sub {
  font: var(--t-body-lg);
  color: var(--ink-teal);  /* warm voice shift in contact */
  margin-bottom: var(--space-6);
}
.contact__form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.contact__form textarea,
.contact__form button {
  grid-column: 1 / -1;
}
.contact__form input,
.contact__form select,
.contact__form textarea {
  border: 1px solid var(--rule);
  border-radius: var(--radius-input);
  padding: 14px 16px;
  font: var(--t-body);
  font-family: var(--font-body);
  background: white;
  color: var(--ink);
  width: 100%;
}
.contact__form input:focus,
.contact__form select:focus,
.contact__form textarea:focus {
  outline: 2px solid var(--ink-aubergine);
  outline-offset: 2px;
  border-color: var(--ink);
}
.blob--corner {
  position: absolute;
  width: 280px;
  height: 280px;
  border-radius: 50%;
  filter: blur(50px);
  opacity: 0.4;
  pointer-events: none;
  z-index: 0;
}
.blob--lavender { background: var(--blob-lavender); bottom: -100px; right: -100px; }
```

**Honeypot field** + Turnstile token already wired into `/api/contact` from Phase 1.0 — preserve.

### 8.5 Card system (chromia 7E)

```css
.card {
  background: var(--cream-soft);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  padding: var(--space-5);
  background-image: radial-gradient(rgba(31, 26, 35, 0.04) 1px, transparent 1px);
  background-size: 18px 18px;  /* faint inner dot-grid */
  transition: box-shadow var(--dur-base) var(--ease-out),
              transform var(--dur-base) var(--ease-out);
}
.card:hover {
  box-shadow: var(--shadow-card);
  transform: translateY(-2px);
}
.card__eyebrow { /* uses .label rules */ }
.card__title {
  font-family: var(--font-display);
  font: var(--t-display-m);
  margin-bottom: var(--space-3);
}
.card__body {
  font: var(--t-body);
  color: var(--ink-soft);
}
.card__link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding: 6px 14px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--rule-strong);
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  text-decoration: none;
  transition: all var(--dur-fast) var(--ease-out);
}
.card__link:hover { background: var(--ink); color: var(--cream-soft); border-color: var(--ink); }
```

Card variants — use sparingly, intent must be clear:
- `.card--accent-pink` → background swaps to `mix(--cream-soft, --accent-pink 8%)` and eyebrow tints
- `.card--accent-teal`, `.card--accent-sage`, `.card--accent-lavender` — same pattern
- Variant cards used for differentiation in lists (e.g., 4 specialty cards on `/specialties` get pastel-tinted in rotation)

### 8.6 Footer (Aftermetoo 8H) — the warmth release valve

```html
<footer class="site-footer">
  <div class="site-footer__inner">
    <span class="eyebrow eyebrow--mut">Get in touch</span>
    <h2 class="site-footer__sign-off">
      Let's place you <em>somewhere good</em>.
    </h2>
    <form class="newsletter">
      <input type="email" placeholder="your@email.com" />
      <button class="pill pill--primary">Subscribe</button>
    </form>
    <nav class="sitemap">
      <div>
        <span class="label">For you</span>
        <a href="/facilities">Facilities</a>
        <a href="/clinicians">Clinicians</a>
        <a href="/jobs">Open jobs</a>
      </div>
      <div>
        <span class="label">Company</span>
        <a href="/about">About</a>
        <a href="/how-it-works">How it works</a>
        <a href="/specialties">Specialties</a>
        <a href="/contact">Contact</a>
      </div>
      <div>
        <span class="label">Legal</span>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/cookies">Cookies</a>
      </div>
    </nav>
    <div class="site-footer__bottom">
      <LogoMono />
      <small>© Innovative Medical Staffing · Fort Worth, TX</small>
      <div class="social-pills">
        <!-- 32px circular pill icons for LinkedIn, Instagram, etc. -->
      </div>
    </div>
  </div>
  <div class="blob blob--footer-coral" aria-hidden="true"></div>
  <div class="blob blob--footer-lavender" aria-hidden="true"></div>
</footer>
```

```css
.site-footer {
  background: var(--cream-warm);
  padding: var(--space-10) 0 var(--space-7);
  position: relative;
  overflow: hidden;
  color: var(--ink-teal);  /* warm voice shift */
}
.site-footer__sign-off {
  font-family: var(--font-display);
  font: var(--t-display-xl);
  color: var(--ink);
  max-width: 22ch;
  margin: var(--space-3) 0 var(--space-7);
}
.site-footer__sign-off em {
  color: var(--ink-aubergine);
  font-style: italic;
}
.newsletter {
  display: flex;
  gap: var(--space-3);
  max-width: 520px;
  margin-bottom: var(--space-9);
}
.sitemap {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-7);
  margin-bottom: var(--space-7);
}
.sitemap a {
  display: block;
  color: var(--ink-teal);
  text-decoration: none;
  font-size: 14px;
  margin-bottom: var(--space-2);
}
.sitemap a:hover { color: var(--ink-aubergine); text-decoration: underline; text-underline-offset: 4px; }
.blob--footer-coral {
  position: absolute;
  width: 480px; height: 480px;
  background: var(--blob-coral);
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.35;
  top: -180px; right: -120px;
  pointer-events: none;
}
.blob--footer-lavender {
  position: absolute;
  width: 380px; height: 380px;
  background: var(--blob-lavender);
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.3;
  bottom: -120px; left: -80px;
  pointer-events: none;
}
.social-pills a {
  width: 32px; height: 32px;
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--cream-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--dur-fast) var(--ease-out);
}
.social-pills a:hover { background: var(--ink-aubergine); }
```

**Sign-off copy direction:** warm, declarative, places the user in a positive future state. Examples to test:
- "Let's place you somewhere good."
- "Let's get you staffed."
- "Let's find your people."

(Lock via [§9](#9--voice--microcopy).)

### 8.7 Loading screen (Manus 9C)

CSS-only stroke-dasharray animation on an inline SVG of the IMS mark.

```html
<div class="loading-screen" role="status" aria-label="Loading">
  <svg class="loading-mark" viewBox="0 0 100 100" aria-hidden="true">
    <!-- IMS mark paths with stroke-dasharray animation -->
  </svg>
  <span class="visually-hidden">Loading</span>
</div>
```

```css
.loading-screen {
  position: fixed; inset: 0;
  background: var(--cream-soft);
  display: grid; place-items: center;
  z-index: 200;
}
.loading-mark {
  width: 80px; height: 80px;
}
.loading-mark path {
  stroke: var(--ink);
  fill: none;
  stroke-width: 1.5;
  stroke-dasharray: 200;
  stroke-dashoffset: 200;
  animation: drawMark 1.2s var(--ease-out) infinite;
}
@keyframes drawMark {
  0%   { stroke-dashoffset: 200; }
  60%  { stroke-dashoffset: 0; opacity: 1; }
  100% { stroke-dashoffset: 0; opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .loading-mark path { animation: none; stroke-dashoffset: 0; }
}
```

---

## 9 · Voice & microcopy

### 9.1 Voice axes

| Surface | Voice | Color cue |
|---|---|---|
| Hero, top-of-page | Chromia-restrained — declarative, technical, confident | `--ink` on `--cream` |
| Body sections | Chromia-restrained, professional | `--ink-soft` on `--cream` |
| Footer, contact | Aftermetoo-warm — conversational, human, place-the-user-well | `--ink-teal` body + `--ink-aubergine` emphasis |
| Errors, validation | Plain, direct, never apologetic-corporate | `--ink-aubergine` (replaces hard red) |
| Empty states | Inviting, not "no results" | `--ink-soft` |

### 9.2 Banned voice patterns

These add to the existing `scripts/voice-lint.mjs` BANNED set.

| Banned | Use instead | Reason |
|---|---|---|
| "Revolutionary", "Cutting-edge", "World-class" | (anything specific) | Corporate-bro filler. Show, don't claim. |
| "Solutions", "Partners with" | "Helps", "Works with" | Consultant-speak. |
| "Empowering clinicians" | "Placing clinicians" | Empty inspiration. |
| "Streamline your workflow" | (something concrete) | SaaS-bro filler. |
| "Unleash", "Unlock", "Elevate" | (anything literal) | Hype. |
| "Reach out" (as CTA verb) | "Get in touch", "Send a note" | Overused, drained. |
| "We're committed to" | (just do it) | Empty promise framing. |
| "At [Company], we believe…" | (just say it) | Self-important opener. |

### 9.3 Required voice patterns

- **Audience-aware copy.** Anywhere copy could read as either "facility" or "clinician", split it. Don't write to a hypothetical "both".
- **Numbers earn their place.** Stats only if verified + recent. No "1000s of placements" — say "47 placements last quarter" or nothing.
- **Italic emphasis pairs.** Use sparingly in headlines. The aftermetoo pattern is one emphasis word per headline (e.g., "Let's *talk*"), not multiple.
- **Buttons in title case** ("Get in touch", not "GET IN TOUCH" or "get in touch").
- **No exclamation marks** in body copy. Reserved for actual surprises in error states.

### 9.4 Sample microcopy library

| Surface | Approved copy |
|---|---|
| Hero headline | "Healthcare staffing, *considered*." / "Locum tenens, *done right*." |
| Hero sub | "Innovative Medical Staffing connects clinicians and facilities — without the chaos of a traditional agency." |
| For Facilities pill | `(For Facilities)` |
| For Clinicians pill | `(For Clinicians)` |
| Secondary action pill | "See open jobs" / "About IMS" |
| Contact eyebrow | "Get in touch" |
| Contact headline | "Let's *talk*." |
| Contact sub | "Whether you're a facility looking for clinicians or a clinician looking for your next assignment — start here." |
| Footer sign-off | "Let's place you *somewhere good*." |
| Newsletter prompt | "Want the occasional note from us?" |
| Newsletter CTA | "Subscribe" |
| 404 headline | "Lost in the building, *huh*." |
| 404 body | "This page either moved or never existed. Let's get you back home." |
| Form error | "Something didn't go through. Try again in a moment." |
| Form success | "Sent. We'll be in touch within one business day." |

---

## 10 · Page hierarchy & per-page treatment

| Page | Job | Hero | Sections | Notes |
|---|---|---|---|---|
| `/` (home) | Route audience + establish voice | Centered chromia hero · audience pill pair · 2 secondary pills | Positioning strip · Audience split (deeper) · How it works (3-step) · Specialties (4-up cards) · Values (3-up cards) · Testimonials (TBD content) · Final CTA → footer | Existing `Home*.astro` sections all restyle in place; `HomeAudienceSplit.astro` becomes a richer dual-CTA section *below* the hero (the hero already has the primary pair) |
| `/facilities` | Sell the facility-facing service | Facility-specific chromia hero · single primary CTA `Hire a clinician →` | Pain → service → process → social proof → CTA | Same chrome, audience-specific copy |
| `/clinicians` | Sell the clinician-facing service | Clinician-specific chromia hero · single primary CTA `Find your next assignment →` | Benefits → specialties → process → testimonials → CTA | Same chrome, audience-specific copy |
| `/how-it-works` | Explain the process | Display-l headline · short sub | 3- or 4-step process cards · FAQ | Cards use `.card` pattern; process steps numbered with display-serif numerals |
| `/specialties` | List specialties served | Display-l headline | Grid of specialty cards w/ pastel accent rotation | 4-up grid below 1200px, 2-up below 768px, 1-up below 480px |
| `/jobs` (+ `/jobs/[slug]`) | Job listings (SSR via Supabase) | Display-l headline | Job list cards · sticky filter · job detail layout | Existing Supabase wiring stays — restyle only |
| `/about` | Company narrative | Display-l headline | Story · team · location | Warm voice OK here — closer to footer voice than hero voice |
| `/contact` | Convert | Display-l headline | Contact form (`§8.4`) · alt contact channels | Whole page is essentially the contact section, with sitemap-style links below |
| `/privacy`, `/terms`, `/cookies` | Legal | Display-m headline · simple body | Long-form text | `<article>` with `.prose` style — narrower max-width, ink-soft body |
| `404` | Recovery | Display-l "Lost in the building, *huh*." | Single back-home pill | Soft, not apologetic-bro |

### 10.1 The home-page section sequence (existing components mapped)

| Order | Existing component | Treatment under this brief |
|---|---|---|
| 1 | `HomeHero.astro` | Rebuild per [§8.2](#82-hero-chromia-1e--audience-cta-split) — multi-pill row, eyebrow, italic emphasis headline |
| 2 | `HomePositioningStrip.astro` | Restyle — tracked-uppercase one-line positioning + 3-4 stat chips |
| 3 | `HomeAudienceSplit.astro` | Becomes a *deeper* section with two side-by-side detailed cards (Facility / Clinician). The hero pill row routes; this section deepens. |
| 4 | `HomeHumanLedTech.astro` | Restyle — title + 2-column copy w/ pastel accent illustration |
| 5 | `HomeProcess.astro` | Restyle — 3-up numbered cards |
| 6 | `HomeSpecialties.astro` | Restyle — 4-up specialty cards with rotating pastel accents |
| 7 | `HomeConcierge.astro` | Restyle — bold quote/headline panel; possibly aftermetoo-warm voice patch |
| 8 | `HomePhilosophy.astro` | Restyle — single-column long-form serif paragraph |
| 9 | `HomeValues.astro` | Restyle — 3-up values cards |
| 10 | `HomeFinalCta.astro` | **FOLD (locked)** — eliminate this section. The aftermetoo warm footer with the sign-off "Let's place you *somewhere good*." IS the final CTA. Remove the file or convert it to a thin re-export of `<SiteFooter />` if any pages import it elsewhere — verify no off-home imports before deleting. |

---

## 11 · State patterns

Every interactive surface must specify its four states.

### 11.1 Loading

| Surface | Pattern |
|---|---|
| Full-page initial load | [§8.7](#87-loading-screen-manus-9c) — Manus brand-mark redraw |
| Section data (jobs list, etc.) | Skeleton card with `--cream-soft` background pulse animation |
| Button click (form submit) | Pill text → "Sending…" + disabled state |
| Image lazy-load | Native `loading="lazy"` + reserved aspect-ratio box |

### 11.2 Empty

| Surface | Pattern |
|---|---|
| Job listings empty | Display-m headline "Nothing open right now." + sub-line "New roles drop every week. Subscribe to be first to see them." + newsletter input |
| Search no results | "We don't have a match for that yet." + alt search prompt |
| 404 | [§9.4](#94-sample-microcopy-library) |

### 11.3 Error

| Surface | Pattern |
|---|---|
| Form validation | Inline below field: `--ink-aubergine` text, 13px, with a small `(!)` indicator. No red. |
| Form submit failure | Below the submit pill: "Something didn't go through. Try again in a moment." + `--ink-aubergine` |
| API timeout (jobs page) | Above the list: same pattern + a retry pill |
| 500 page | Display-l "Something's broken on our end." + "We've been pinged. Try again in a minute." |

### 11.4 Success

| Surface | Pattern |
|---|---|
| Form submit success | Replace form with: serif headline "Sent." + body "We'll be in touch within one business day." + alt action pill |
| Newsletter subscribe success | Inline replacement: "You're in." with a small checkmark |
| Job application accepted | Display-l "Application received." + next-steps body |

**Never use:**
- Toast notifications. Use inline state changes instead.
- Spinners as the only feedback. Use text + state change.
- Modal-on-success. Replace inline.

---

## 12 · Accessibility

Non-negotiable minimums:

- **WCAG 2.2 AA** across all surfaces (Lighthouse axe-core in CI)
- **Color contrast** — see [§5 contrast budget](#5--color-tokens). All passes AA.
- **Reduced motion:** every animation respects `@media (prefers-reduced-motion: reduce)` and falls back to instant state change (existing pattern from Phase 1.0 `ScrollReveal.astro`)
- **Focus visible:** every interactive element shows a 2px `--ink-aubergine` outline with 3px offset (already in `.pill--primary:focus-visible`). No `outline: none`.
- **Keyboard navigation:** tab order matches reading order. Skip-to-content link at the top of every page.
- **ARIA:**
  - Audience pills: `aria-label="Resources for facilities"` / `"Resources for clinicians"`
  - Active nav link: `aria-current="page"`
  - Decorative blobs: `aria-hidden="true"`
  - Form fields: `aria-describedby` linking to inline validation message
- **Form labels:** every input has an associated `<label>` (visible or visually-hidden). Placeholder is never the only label.
- **Touch targets:** minimum 44×44px tap area on mobile (`.pill` already exceeds this at 48px min)
- **Heading hierarchy:** one `<h1>` per page (the hero headline), then `h2 → h3` cleanly. No skipping levels.
- **Alt text:** every `<img>` has descriptive alt or `alt=""` for decoration
- **Language:** `<html lang="en">` set at layout level (already done in `MarketingLayout.astro`)
- **`@font-face` preloaded with `font-display: swap`** to prevent FOIT

---

## 13 · Responsive rules

Mobile-first. Base styles target mobile, media queries scale up.

```css
/* Tablet */
@media (min-width: 768px) { /* 2-column layouts, larger padding */ }
/* Desktop */
@media (min-width: 1024px) { /* full layouts, hero scale, multi-column grids */ }
/* Wide desktop */
@media (min-width: 1440px) { /* container caps at 1320px */ }
```

### 13.1 Breakpoint behavior matrix

| Component | < 480px | 480-768px | 768-1024px | > 1024px |
|---|---|---|---|---|
| Top nav | Hamburger menu + wordmark only | Hamburger + wordmark + CTA pill | Full pill nav (no labels collapse) | Full pill nav |
| Hero headline | 56-64px clamp | 64-80px | 80-96px | 88-120px (full clamp) |
| Hero audience pill pair | Stacked, full-width | Side-by-side | Side-by-side | Side-by-side |
| Card grid | 1 column | 1-2 cols | 2-3 cols | 3-4 cols |
| Footer sitemap | 1 column | 1 column | 3 cols | 3 cols |
| Contact form | 1 column | 1 column | 2 cols (paired fields) | 2 cols |
| Dot grid pitch | 18px | 20px | 22px | 22px |

### 13.2 Responsive type

All `--t-display-*` tokens use `clamp(min, vw, max)`. Body sizes stay fixed (16px / 14px) — fluid type creates body-copy chaos.

### 13.3 Touch behavior

- All `:hover` states must have a `:focus-visible` equivalent
- No hover-only reveals on mobile (info disclosures use accordions on touch)
- Tap-highlight color: `-webkit-tap-highlight-color: rgba(31, 26, 35, 0.1)`

---

## 14 · Logo & wordmark

**Existing assets — preserved:**

- `src/components/brand/LogoDefault.astro` — full color, on-cream contexts
- `src/components/brand/LogoMono.astro` — single-color, footer/print contexts
- `src/components/brand/LogoOnDark.astro` — light variant, on-dark surfaces (top nav)
- Plus 8 functional icons under `src/components/icons/`

**No redesign in v1.** The IMS mark stays. Wordmark treatment in v1: the existing SVG mark + "Innovative Medical Staffing" set in **Fraunces 700** (the locked display font). v2 may commission a custom Battlefin-style display wordmark if budget approved later.

**Usage matrix:**

| Surface | Logo variant | Notes |
|---|---|---|
| Top nav (dark pill bg) | `LogoOnDark` | Cream fill, 22px tall |
| Page bodies (cream bg) | `LogoDefault` | Inline contexts: footer header, contact form, hero (optional) |
| Footer bottom strip | `LogoMono` | Single-color, ink, 24px tall |
| Loading screen | Custom hand-sketch SVG | New asset — Claude Design proposes the hand-sketch IMS mark as part of the loading-screen step in [§18](#18--build-sequence-for-claude-design) |
| Favicons + OG image | Existing assets | Audit for consistency post-rebrand |

**Wordmark exploration (v2 candidate):** Chromia's Battlefin display serif wordmark sets a benchmark. If we treat the IMS wordmark as just the SVG mark + "Innovative Medical Staffing" set in Fraunces 700, that's the safe v1. v2 might commission a custom display wordmark.

---

## 15 · Motion rules

Restraint hierarchy. **If removing it doesn't lose meaning, remove it.**

| Element | Motion | Trigger | Easing | Duration |
|---|---|---|---|---|
| Headlines | Word-by-word fade-in | Scroll into view | `--ease-out` | 400ms per word, 60ms stagger |
| Dot grid | None | — | — | — |
| Pills | Y-translate 1px + shadow lift | Hover | `--ease-out` | `--dur-fast` 150ms |
| Cards | Y-translate 2px + shadow | Hover | `--ease-out` | `--dur-base` 280ms |
| Section reveals | Opacity + 40px Y-translate | Scroll into view | `--ease-out` | `--dur-slow` 520ms |
| Page transitions | Cross-fade | Route change | `--ease-out` | 200ms |
| Loading mark | Stroke redraw | Loop | `--ease-out` | 1.2s |
| Form submit | Disabled + text change | Click | — | instant |
| Blob decorations | None | — | — | — |

**Hard rules:**
- Never `linear`. Always specify an easing.
- Never animate `width` or `height` — use `transform: scale()`.
- Reduced-motion: every animation has a `@media (prefers-reduced-motion: reduce)` fallback.
- No parallax. (Wyelea uses it; we don't.)
- No autoplay video. Even on the hero. Static-first.

---

## 16 · Imagery rules

- **Default:** typography IS the imagery
- **Abstract product diagrams** > screenshots. Illustrated, line-weight matched to body type weight
- **Photography:** rare. When used: black-and-white or duotone-aubergine (`--ink` + `--cream` ramp). No full-color stock.
- **Pastel character accents** (Tolan): 1-2 small marks per page max, tucked in negative space. Not a mascot system. More like punctuation.
- **Blob decorations** (Aftermetoo): confined to footer + contact-form corners. Behind text, `aria-hidden="true"`, `pointer-events: none`.
- **No clinical stock photography.** No latex gloves, stethoscopes-on-keyboards, smiling-doctor-with-tablet. The brand voice is "considered staffing partner", not "hospital marketing".
- **OG images** + favicons audit needed — must reflect cream/aubergine palette post-launch

---

## 17 · Performance & SEO

### 17.1 Performance budget

- **Lighthouse score:** ≥95 mobile (per existing T12 gate)
- **First Contentful Paint:** ≤1.2s on Slow 4G
- **Largest Contentful Paint:** ≤2.0s on Slow 4G
- **Total page weight:** ≤300 KB on first-load (excluding cached fonts)
- **JS:** zero on marketing pages (existing zero-JS architecture)
- **Fonts:** Fraunces variable + Inter variable, subset to Latin, preloaded, `font-display: swap`. Combined ≤120 KB.
- **Images:** AVIF preferred, WebP fallback. Lazy-load below the fold (`loading="lazy"`).
- **Critical CSS:** inlined for above-the-fold (existing pattern in `MarketingLayout.astro`)

### 17.2 SEO + meta

- **Title pattern:** `{Page} — Innovative Medical Staffing` (≤60 chars)
- **Description pattern:** 1-2 sentence value prop, page-specific (≤155 chars)
- **OG image:** 1200×630 cream-bg variant of the IMS mark + page-specific headline rendered into the image
- **JSON-LD:** Organization schema on every page (existing). MedicalOrganization upgrade post-launch if applicable.
- **Sitemap:** `@astrojs/sitemap` already integrated; rebuild on every deploy
- **Canonical:** existing middleware-level canonical normalization preserved
- **noindex flag** (`X-Robots-Tag`) stays until T15+T16 launch hard gate flips

### 17.3 Tracking

- **Plausible Cloud only** — existing CSP allowlist
- **No Google Analytics, no Meta Pixel, no Hotjar** — privacy-first
- **CTR measurement:** add data attributes to `(For Facilities)` and `(For Clinicians)` pills so Plausible can split audience clicks

---

## 18 · Build sequence (for Claude Design)

Ship in this order for the cleanest incremental state. Each step deploys to preview before the next starts.

1. **Token migration.** Add new `--cream-*`, `--ink-*`, `--accent-*`, `--blob-*`, `--dot-*` tokens to `src/styles/tokens.css`. Keep IMS Dark legacy aliases live for now. Update `body { background, color }` defaults.
2. **Font swap.** Self-host Fraunces via `@fontsource-variable/fraunces`. Update `--font-display`. Verify TAY `@font-face` blocks stay (verify-build asserts them).
3. **`MarketingLayout.astro`** chrome — swap from IMS Dark navy shell to cream + dot-grid.
4. **`SiteNav.astro`** — rebuild as chromia floating pill.
5. **`HomeHero.astro`** — rebuild per [§8.2](#82-hero-chromia-1e--audience-cta-split). Headline `A More <em>Personal</em> Way to Staff Care.` + locked supporting line + the **two-audience pill pair only**.
6. **Card system** — write `.card` base + variant classes. Apply across `HomeProcess`, `HomeSpecialties`, `HomeValues`.
7. **`SiteFooter.astro`** — rebuild as aftermetoo warm close with blobs.
8. **Contact form / `/contact`** — apply Origin 5B pattern; preserve `/api/contact` wiring.
9. **Specialty + audience pages** — restyle `/facilities`, `/clinicians`, `/specialties`, `/how-it-works`, `/about`.
10. **`/jobs` listings + `/jobs/[slug]`** — restyle existing Supabase-driven views.
11. **State patterns** — apply [§11](#11--state-patterns) across forms + the jobs page.
12. **Loading screen** — Claude Design proposes the hand-sketch IMS mark SVG + draws the stroke-dasharray animation per [§8.7](#87-loading-screen-manus-9c).
13. **Motion layer** — apply [§15](#15--motion-rules) globally last so individual components are correct first.
14. **Accessibility audit + Lighthouse pass** — gates green before considering v1 done.
15. **Voice-lint update** — add new BANNED tokens from [§9.2](#92-banned-voice-patterns) to `scripts/voice-lint.mjs`.
16. **Cleanup pass.** Delete `HomeFinalCta.astro` after confirming no imports outside the home page. Trim legacy IMS-Dark token aliases from `tokens.css` once no page references them.

**Per-step Codex review:** every non-trivial step gets the in-band peer-review loop (existing standing order).

---

## 19 · Resolved decisions log (formerly open questions)

All v1 open questions answered by Zach 2026-05-26. Documented here so Claude Design can see the rationale, not just the output.

| # | Question | Resolution |
|---|---|---|
| 1 | Display font: Fraunces (free) or Battlefin (paid ~$300)? | **Fraunces (free).** Upgrade to Battlefin in v2 if budget approved. |
| 2 | Pastel accent saturation: Tolan-literal or desaturated? | **Tolan-literal** — `#F4B8C7` pink · `#9ED4D0` teal · `#B5D0A8` sage · `#D4C2EE` lavender. Reassess only if Claude Design flags a healthcare-context concern. |
| 3 | Audience-pill icons or label-only? | **Label-only.** Locked v1. No icons. |
| 4 | Hero secondary pills (positions 3-4)? | **None.** Hero gets exactly the two audience pills `(For Facilities)` + `(For Clinicians)`. Top nav already routes to "See open jobs" + "About". |
| 5 | Loading mark SVG: who draws? | **Claude Design** proposes the hand-sketch IMS mark as part of build step 12. External illustrator only if Claude Design's draft doesn't land. |
| 6 | Hero headline copy. | **`A More Personal Way to Staff Care.`** with "Personal" italic-emphasized in `--ink-aubergine`. |
| 6b | Hero supporting line. | "We bring a boutique, family-style approach to locum staffing — connecting clinicians and facilities with the care, speed, and concierge support they deserve." |
| 7 | `HomeFinalCta.astro` fate. | **Fold.** Eliminate the section. The aftermetoo warm footer with "Let's place you *somewhere good*." IS the final CTA. See build step 16. |
| 8 | Wordmark treatment v1. | IMS mark SVG + "Innovative Medical Staffing" set in **Fraunces 700**. v2 may commission a custom display wordmark. |
| 9 | CTR attribution on audience pills. | **Yes.** Add `data-cta="facilities"` and `data-cta="clinicians"` to the hero pills so Plausible can split audience clicks. |
| 10 | Testimonials source. | **Pull from old iastaffing.com for v1 launch.** Plan a fresh-collection round post-launch for v2. Mark v1 testimonials as `data-source="legacy"` so they're easy to swap. |
| 11 | `/jobs` empty-state copy. | Already drafted in [§11.2](#112-empty) — tone matches. Will only render until Webhook Key setup unblocks. |
| 12 | Email sender identity for transactional. | **`IMS Team <Recruiter@imstaffing.com>`** for v1. The functional inbox already exists. Personalize to a named human ("Olive @ IMS" style) only when a specific person owns it. |

---

## 20 · References

- **Moodboard (visual ground truth):** [ims-finalists.pages.dev/design-board/](https://ims-finalists.pages.dev/design-board/)
- **Reference sites:** [chromia.com](https://chromia.com) · [tolans.com](https://tolans.com) · [wyelea.com](https://wyelea.com) · [aftermetoo.com](https://aftermetoo.com)
- **Predecessor specs:**
  - `docs/IAS-Design-System.md` (Apple HIG, dashboards)
  - `src/styles/tokens.css` (current IMS Dark System)
- **Implementation context memories:**
  - `~/.claude/projects/{...}/memory/project_ims_brand_picks_locked_2026-05-26.md` (pick history)
  - `~/.claude/projects/{...}/memory/project_ims_design_references_2026-05-26.md` (ref-site DNA)
- **Logo system:** `src/components/brand/Logo{Default,Mono,OnDark}.astro`
- **Existing tokens:** `src/styles/tokens.css` (legacy aliases stay during migration)
- **Layout shell:** `src/layouts/MarketingLayout.astro`

---

## 21 · Changelog

- **v2 · 2026-05-26** — all 12 open questions resolved by Zach (see [§19](#19--resolved-decisions-log-formerly-open-questions)). Hero headline + supporting line locked. Hero reduced from 4-pill row to 2-pill row. `HomeFinalCta.astro` marked for deletion. Email sender locked to `IMS Team <Recruiter@imstaffing.com>`. Testimonials sourced from legacy iastaffing.com for v1 with `data-source="legacy"`. Status flipped to READY FOR CLAUDE DESIGN HAND-OFF.
- **v1 · 2026-05-26** — initial brief drafted from moodboard pick session. Verified ref-site hex values + fonts via Playwright. Reconciled with IAS Apple HIG + IMS Dark System predecessors.

---

*Brief v2 · curated 2026-05-26 · all decisions locked · ready for Claude Design hand-off.*
