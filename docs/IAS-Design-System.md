# IAS Design System — Claude Code Reference

> Drop this file into your `.claude/CLAUDE.md` or project root `CLAUDE.md` to ensure all dashboards, tools, and apps match the IAS design language.

---

## Design Philosophy

We follow an **Apple HIG-inspired** design language: clean, spacious, depth-aware, and responsive. Every interface should feel like a native iOS/macOS app — not a Bootstrap template.

**Core principles:**
- **Clarity over decoration** — every element earns its place
- **Depth through light** — shadows, borders, and layered backgrounds create hierarchy (no flat design, no skeuomorphism)
- **Smooth motion** — spring-based easing, never linear or jarring
- **Dark mode is first-class** — every color token has a light and dark variant
- **Responsive by default** — mobile isn't an afterthought, it's a constraint

---

## Color System

Use CSS custom properties. Every color has a semantic role — never hardcode hex values inline.

### Light Mode

```css
:root {
  /* Backgrounds */
  --bg:             #ffffff;
  --bg-alt:         #f5f5f7;
  --bg-card:        #ffffff;
  --bg-elevated:    rgba(255, 255, 255, 0.72);
  --bg-inset:       #f2f2f7;

  /* Text */
  --text:           #1d1d1f;
  --text-secondary: rgba(60, 60, 67, 0.6);
  --text-tertiary:  rgba(60, 60, 67, 0.3);

  /* Accent */
  --accent:         #007aff;
  --accent-hover:   #0071e3;
  --accent-bg:      rgba(0, 122, 255, 0.08);

  /* Status Colors */
  --green:          #34c759;
  --green-bg:       rgba(52, 199, 89, 0.08);
  --orange:         #ff9500;
  --orange-bg:      rgba(255, 149, 0, 0.08);
  --red:            #ff3b30;
  --red-bg:         rgba(255, 59, 48, 0.08);
  --purple:         #af52de;
  --purple-bg:      rgba(175, 82, 222, 0.08);
  --teal:           #5ac8fa;
  --yellow:         #ffcc00;

  /* Borders & Fills */
  --border:         rgba(0, 0, 0, 0.08);
  --border-strong:  rgba(0, 0, 0, 0.16);
  --fill:           rgba(120, 120, 128, 0.2);
  --fill-secondary: rgba(120, 120, 128, 0.16);

  /* Shadows */
  --shadow:         0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.03);
  --shadow-md:      0 2px 12px rgba(0, 0, 0, 0.06);
  --shadow-lg:      0 8px 30px rgba(0, 0, 0, 0.08);
  --shadow-elevated:0 8px 32px rgba(0, 0, 0, 0.1), 0 2px 6px rgba(0, 0, 0, 0.04);
}
```

### Dark Mode

```css
@media (prefers-color-scheme: dark) {
  :root {
    /* Backgrounds */
    --bg:             #000000;
    --bg-alt:         #1d1d1f;
    --bg-card:        #1c1c1e;
    --bg-elevated:    rgba(28, 28, 30, 0.82);
    --bg-inset:       #1c1c1e;

    /* Text */
    --text:           #f5f5f7;
    --text-secondary: rgba(235, 235, 245, 0.6);
    --text-tertiary:  rgba(235, 235, 245, 0.3);

    /* Accent */
    --accent:         #2997ff;
    --accent-hover:   #40a9ff;
    --accent-bg:      rgba(41, 151, 255, 0.1);

    /* Status Colors */
    --green:          #30d158;
    --green-bg:       rgba(48, 209, 88, 0.12);
    --orange:         #ff9f0a;
    --orange-bg:      rgba(255, 159, 10, 0.12);
    --red:            #ff453a;
    --red-bg:         rgba(255, 69, 58, 0.12);
    --purple:         #bf5af2;
    --purple-bg:      rgba(191, 90, 242, 0.12);
    --teal:           #64d2ff;
    --yellow:         #ffd60a;

    /* Borders & Fills */
    --border:         rgba(255, 255, 255, 0.08);
    --border-strong:  rgba(84, 84, 88, 0.6);
    --fill:           rgba(120, 120, 128, 0.36);
    --fill-secondary: rgba(120, 120, 128, 0.32);

    /* Shadows */
    --shadow:         0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2);
    --shadow-md:      0 2px 12px rgba(0, 0, 0, 0.3);
    --shadow-lg:      0 8px 30px rgba(0, 0, 0, 0.4);
    --shadow-elevated:0 8px 32px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.2);
  }
}
```

### Color Usage Rules

| Purpose | Token | Never Do |
|---------|-------|----------|
| Primary text | `var(--text)` | Don't use `#000` or `#fff` directly |
| Secondary labels | `var(--text-secondary)` | Don't use gray hex codes |
| Positive/success | `var(--green)` on `var(--green-bg)` | Don't use green without its soft background |
| Negative/error | `var(--red)` on `var(--red-bg)` | Don't use bare red text |
| Warning/neutral | `var(--orange)` on `var(--orange-bg)` | Same pattern — always pair |
| Interactive accent | `var(--accent)` | Don't invent new blues |

**Key rule:** Status colors always appear as colored text on a soft-tinted background, never as solid fills (except in charts).

---

## Typography

```css
:root {
  --font:  -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Inter', system-ui, sans-serif;
  --mono:  'IBM Plex Mono', 'SF Mono', 'Menlo', monospace;
}
```

### Type Scale

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Page title | `clamp(28px, 4vw, 48px)` | 700 | 1.1 |
| Section heading | `clamp(20px, 2.5vw, 28px)` | 600 | 1.2 |
| Card title | `17px - 21px` | 600 | 1.3 |
| Body text | `14px - 15px` | 400 | 1.5 |
| Caption / label | `12px - 13px` | 500 | 1.4 |
| Small / mono | `11px` | 400 | 1.4 |

### Typography Rules
- Use `font-weight: 600` for emphasis, **not bold (700)** except for hero numbers
- Large stat numbers: `font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums`
- Monospace for numbers in tables, codes, and IDs
- Letter-spacing: `0.02em` on captions/labels, `0` everywhere else

---

## Spacing & Layout

### Border Radius Scale

```css
:root {
  --r-xs:   8px;    /* inputs, small controls, badges */
  --r-sm:   12px;   /* secondary cards, tooltips */
  --r:      18px;   /* primary cards, containers */
  --r-lg:   20px;   /* hero sections, modal dialogs */
  --r-xl:   28px;   /* page-level containers, featured cards */
  --r-pill: 980px;  /* buttons, pills, tags */
}
```

### Spacing

Use **multiples of 4px**. Common values:
- `4px` — tight gaps (icon-to-text)
- `8px` — small gaps (badge padding, list items)
- `12px` — medium gaps (card grid gaps, section dividers)
- `16px` — standard padding (inputs, compact cards)
- `20px-24px` — comfortable padding (cards on mobile)
- `28px-32px` — generous padding (cards on desktop)
- `40px-48px` — section spacing

### Grid & Layout
- Card grids: `display: grid; gap: 12px-16px`
- Desktop: 2-3 columns with `auto-fit, minmax(320px, 1fr)`
- Mobile: single column, full-width cards
- Max content width: `1200px` centered
- Page padding: `24px` mobile, `40px` desktop

---

## Shadows & Depth

Four depth levels — use the lowest level that creates sufficient hierarchy:

| Level | Token | Use For |
|-------|-------|---------|
| **Subtle** | `var(--shadow)` | Default card state, static elements |
| **Medium** | `var(--shadow-md)` | Hover states, active cards |
| **Large** | `var(--shadow-lg)` | Floating elements, dropdowns |
| **Elevated** | `var(--shadow-elevated)` | Modals, popovers, nav bars |

**Glassmorphism** (nav bars, floating UI):
```css
.nav-bar {
  background: var(--bg-elevated);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 0.5px solid var(--border);
}
```

---

## Animation & Motion

### Easing Functions

```css
:root {
  --ease:        cubic-bezier(0.25, 0.1, 0.25, 1);    /* standard smooth */
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);        /* deceleration (Apple HIG) */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);    /* spring/bounce */
  --ease-snap:   cubic-bezier(0.32, 0.72, 0.00, 1);    /* snappy/decisive */
}
```

### Timing

| Interaction | Duration | Easing |
|-------------|----------|--------|
| Button press | `0.15s` | `--ease` |
| Hover state | `0.2s` | `--ease` |
| Card transition | `0.3s` | `--ease-out` |
| Page entrance | `0.5s-0.6s` | `--ease-out` |
| Modal open | `0.35s` | `--ease-spring` |
| Staggered items | `0.04s` delay per item | `--ease-out` |

### Motion Rules
- **Never use `linear`** — everything has easing
- **Never animate `width`/`height`** — use `transform: scale()` instead
- **Hover lifts**: `transform: translateY(-2px)` + shadow increase
- **Loading states**: subtle pulse or shimmer, never spinners unless >2s wait
- **Stagger animations** on lists: each item enters 40ms after the previous

---

## Component Patterns

### Cards

```css
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--r);
  padding: 28px;
  transition: all 0.3s var(--ease-out);
}

.card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
```

### Buttons

**Primary (CTA):**
```css
.btn-primary {
  padding: 14px 28px;
  border-radius: var(--r-pill);
  background: var(--accent);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: all 0.2s var(--ease);
}

.btn-primary:hover {
  background: var(--accent-hover);
  transform: scale(1.02);
}
```

**Secondary (pill):**
```css
.btn-secondary {
  padding: 8px 18px;
  border-radius: var(--r-pill);
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s var(--ease);
}

.btn-secondary:hover {
  background: var(--bg-alt);
  border-color: var(--border-strong);
}
```

### Segmented Controls

```css
.segmented {
  display: flex;
  background: var(--bg-alt);
  border-radius: var(--r-xs);
  padding: 2px;
  gap: 1px;
}

.segmented-btn {
  flex: 1;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s var(--ease);
}

.segmented-btn.active {
  background: var(--bg-card);
  color: var(--text);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
```

### Status Badges / Trend Indicators

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--r-pill);
  font-size: 12px;
  font-weight: 600;
}

.badge-positive { background: var(--green-bg); color: var(--green); }
.badge-negative { background: var(--red-bg);   color: var(--red);   }
.badge-warning  { background: var(--orange-bg); color: var(--orange); }
.badge-info     { background: var(--purple-bg); color: var(--purple); }
.badge-neutral  { background: var(--fill);      color: var(--text-secondary); }
```

### Stat Cards

```css
.stat-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}

.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
```

### Inputs

```css
input, textarea {
  background: var(--fill);
  border: none;
  border-radius: var(--r-sm);
  padding: 12px 16px;
  font-size: 15px;
  color: var(--text);
  transition: background 0.2s var(--ease);
}

input:focus, textarea:focus {
  background: var(--fill-secondary);
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

input::placeholder {
  color: var(--text-tertiary);
}
```

### Toggle Switches

```css
.toggle {
  width: 44px;
  height: 24px;
  background: var(--border-strong);
  border-radius: 12px;
  position: relative;
  cursor: pointer;
  transition: background 0.2s var(--ease);
}

.toggle.active {
  background: var(--accent);
}

.toggle::after {
  content: '';
  width: 20px;
  height: 20px;
  background: #ffffff;
  border-radius: 50%;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s var(--ease-spring);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.toggle.active::after {
  transform: translateX(20px);
}
```

### Tooltips / Info Popovers

```css
.tooltip {
  background: var(--text);
  color: var(--bg);
  padding: 12px 16px;
  border-radius: var(--r-sm);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
  max-width: 280px;
  box-shadow: var(--shadow-elevated);
}
```

---

## Hero / Inverted Sections

For hero cards or featured sections, invert the color scheme:

```css
.hero-card {
  background: var(--text);
  color: var(--bg);
  border-radius: var(--r-lg);
  padding: 32px;
}

/* Or gradient hero: */
.hero-gradient {
  background: linear-gradient(135deg,
    rgba(28, 25, 23, 0.98),
    rgba(68, 64, 60, 0.94) 52%,
    rgba(120, 53, 15, 0.82)
  );
  color: #f5f5f7;
  border-radius: var(--r-xl);
}
```

---

## Responsive Breakpoints

```css
/* Mobile first — base styles are mobile */

/* Tablet */
@media (min-width: 768px) {
  /* 2-column layouts, more horizontal space */
}

/* Desktop */
@media (min-width: 1024px) {
  /* Full layouts, 2-3 columns, larger padding */
}
```

### Responsive Rules
- Cards go single-column below `768px`
- Reduce padding by ~30% on mobile (`28px` -> `20px`)
- Font sizes use `clamp()` to scale fluidly
- Touch targets: minimum `44px` height on mobile
- Hide secondary information on mobile, reveal on hover/expand on desktop

---

## Chart / Data Visualization

When using D3, Chart.js, or similar:
- Use the status color palette for data series
- Chart backgrounds: `transparent` (inherit card background)
- Grid lines: `var(--border)` at 0.5px
- Axis labels: `var(--text-tertiary)`, 11px
- Data labels: `var(--text)`, 13px, weight 600
- Tooltips match the tooltip component pattern above
- Smooth line interpolation (no angular/stepped lines unless showing discrete data)
- Animate data entrance with staggered `--ease-out`

---

## Do / Don't

### Do
- Use CSS custom properties for all colors — never hardcode
- Support both light and dark mode
- Use `border-radius: var(--r-pill)` for all buttons
- Pair status colors with their soft backgrounds
- Use `backdrop-filter: blur()` for floating/overlay UI
- Animate with spring or deceleration easing
- Use `clamp()` for responsive typography
- Keep cards at `1px solid var(--border)` — never thicker

### Don't
- Don't use Bootstrap, Material Design, or other opinionated frameworks
- Don't use `border-radius: 4px` — our minimum is `8px`
- Don't use solid color fills for status (green/red/orange) — always use the soft `*-bg` variant
- Don't use `box-shadow` without checking the depth hierarchy
- Don't use `transition: all` without specifying easing — always include `var(--ease*)`
- Don't use `linear` easing for anything
- Don't use pure black (`#000`) text in light mode — use `--text` which is `#1d1d1f`
- Don't use flat gray borders — use the rgba-based `--border` tokens
- Don't forget `font-variant-numeric: tabular-nums` on number displays
- Don't build mobile-hostile layouts — test at 375px width

---

## Tailwind CSS Mapping

If using Tailwind, here's how the tokens map:

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        bg:      'var(--bg)',
        'bg-alt': 'var(--bg-alt)',
        'bg-card': 'var(--bg-card)',
        text:    'var(--text)',
        'text-2': 'var(--text-secondary)',
        'text-3': 'var(--text-tertiary)',
        accent:  'var(--accent)',
        green:   'var(--green)',
        orange:  'var(--orange)',
        red:     'var(--red)',
        purple:  'var(--purple)',
      },
      borderRadius: {
        xs:   '8px',
        sm:   '12px',
        md:   '18px',
        lg:   '20px',
        xl:   '28px',
        pill: '980px',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
    },
  },
}
```

---

## Quick-Start Template

Paste this into any new HTML file to start with the right foundation:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard</title>
  <style>
    /* Paste the :root and @media (prefers-color-scheme: dark) blocks from above */

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }

    @media (min-width: 1024px) {
      .container { padding: 40px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Build here -->
  </div>
</body>
</html>
```

---

*This design system is derived from the IAS production dashboards: LocumSmart Analytics, Rate Calculator, PokeTrader, and Weekly Sync. Last updated April 2026.*

---

## Marketing Phase 1.0 implementation (2026-05-07)

Phase 1.0 foundation primitives are landed across two pushes:

**Shipped to production via PR #1 merge `dfd29fa` (2026-05-07):**
- `@astrojs/cloudflare` adapter v12 + `@astrojs/sitemap` integration (Path A pin — adapter v13+ dropped Pages support).
- Brand palette tokens (PT-derived) added to `src/styles/tokens.css`.
- TAY Basal + TAY Amaya fonts self-hosted at `public/fonts/` with `@font-face` declarations.
- `src/middleware-logic.ts` + `src/middleware.ts` canonical-redirect (`ims-website.pages.dev` → 301 → `innovativemedicalstaffing.com`) + 7 SECURITY_HEADERS defense-in-depth at worker layer.
- `public/_headers` mirrors SECURITY_HEADERS for paths excluded from worker.
- 14/14 vitest middleware tests; 25/25 verify-build structural + content-marker checks.

**Landed on `feat/ims-phase-1a-content` (T6–T11):**
- T6: IMS logo system — 4 SVG variants (Original / Default / OnDark / Mono) + 3 Astro components + 8-icon functional set + `Icon.astro` `?raw`+`set:html` dispatcher. Inline `fill=""` (not class-based `<defs><style>`) prevents class-collision when two logo instances render on the same page.
- T7: `ScrollReveal.astro` IntersectionObserver helper — once-only fade+rise (500ms / 12px / `-10%` rootMargin), feature-guarded against missing IO API, full reduced-motion respect (transition: none + immediate visibility).
- T8: `MarketingLayout.astro` chrome — cream card on dark exterior pattern, Plausible Cloud snippet, Schema.org Organization JSON-LD, canonical normalization (origin+pathname only — strips query/hash/utm), absolute og:image resolution, `inCard` prop toggling cream vs full-bleed.
- T9: CSP rewrite per spec §0.5.3 — `default-src 'self'` + Plausible/Turnstile allowlists across `script-src` / `connect-src` / `frame-src`; `form-action 'self'` (unblocks T46/T47 form POSTs); `frame-ancestors 'none'` preserved. 27/27 verify-build (added 2 content markers asserting Plausible + Turnstile literals inlined in worker bundle).
- T10: `scripts/voice-lint.mjs` advisory script per spec §4.5 / §0.5.6 — scans `src/` + `docs/specs/` for BANNED + CARE + VISUAL_BANNED tokens, skips markdown code fences (eliminates anti-pattern-list noise), surfaces scan errors visibly, exits 0 always at v1 (Phase 1.5 promotes BANNED tier to blocking).
- T11: `npm run verify` chains `verify-build` + `voice-lint`.

**Site is still `noindex`** — the `X-Robots-Tag: noindex, nofollow` header in both `src/middleware-logic.ts` and `public/_headers` is intentionally preserved. Phase 1.A T15 + T16 are the paired removal tasks that flip the site indexable; that's the LAUNCH HARD GATE.

**Codex 3-round adversarial review** ran on every non-trivial commit per session-start standing order. Across T6–T10 the loop caught 6 real shipping-blockers (dark-mode logo invisibility, Astro scoped-CSS not reaching child components, missing IntersectionObserver feature-guard, reduced-motion still animating opacity, canonical leaking utm params, og:image relative path). Verdict chains greppable via `git log --grep="codex-reviewed"`.

**Lighthouse ≥95 gate (T12):** pending Zach manual run in browser DevTools against the preview URL — the placeholder layout is unchanged from production except for the new logo render, so Phase 1.0 score parity is expected.
