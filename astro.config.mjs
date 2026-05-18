// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

const SITE_URL = 'https://innovativemedicalstaffing.com';

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  adapter: cloudflare(),
});
