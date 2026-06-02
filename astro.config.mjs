// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

const SITE_URL = 'https://innovativemedicalstaffing.com';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  adapter: cloudflare(),
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
