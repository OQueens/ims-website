# Innovative Medical Staffing

Public marketing site for [innovativemedicalstaffing.com](https://innovativemedicalstaffing.com).

## Stack

- [Astro](https://astro.build) (SSG, zero JS by default)
- IAS Design System tokens — see [docs/IAS-Design-System.md](docs/IAS-Design-System.md)
- Cloudflare Pages (hosting)
- Namecheap (DNS)

## Status

**Phase 0 — Maintenance page.** Real site under construction.

See [docs/specs/2026-05-05-ims-website-design.md](docs/specs/2026-05-05-ims-website-design.md) for the full design spec and roadmap.

## Local development

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # writes dist/
npm run verify       # post-build assertions
```

## Deploy

Auto-deploys to Cloudflare Pages on push to `main`. PRs get preview URLs.
See [DEPLOY.md](DEPLOY.md) for the one-time setup.
