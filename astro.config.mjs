// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// Canonical FLIP (2026-06-11): imstaffing.ai is the new primary host. This
// drives Astro.site → <link rel=canonical>, og:url, and the sitemap base.
const SITE_URL = 'https://imstaffing.ai';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  adapter: cloudflare(),
  vite: {
    build: {
      // Never inline fonts as `data:` URIs. The site CSP is `font-src 'self'`,
      // which blocks `data:` fonts — Vite's default 4KB inline threshold was
      // silently inlining small @fontsource subset files, tripping CSP on every
      // page (most visibly the hub). Emitting them as same-origin files keeps
      // CSP strict. Non-font assets keep the default threshold (undefined).
      assetsInlineLimit: (filePath) =>
        /\.(woff2?|ttf|otf|eot)(\?.*)?$/i.test(filePath) ? false : undefined,
    },
  },
  integrations: [
    sitemap({
      filter: (page) => {
        const url = new URL(page);
        if (url.pathname.startsWith('/api/')) return false;
        if (url.pathname.startsWith('/og/')) return false;
        if (url.pathname === '/hub' || url.pathname.startsWith('/hub/')) return false;
        if (url.pathname === '/jobs' && url.search) return false;
        return true;
      },
    }),
  ],
});
