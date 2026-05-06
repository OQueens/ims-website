// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

const SITE_URL = 'https://innovativemedicalstaffing.com';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  integrations: [
    sitemap({
      filter: (page) => {
        if (page.startsWith(`${SITE_URL}/api/`)) return false;
        if (page.startsWith(`${SITE_URL}/og/`)) return false;
        if (page.includes('/jobs?')) return false;
        return true;
      },
    }),
  ],
});
