export interface HubEnv {
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  HUB_SESSION_SECRET?: string;
  /** Break-glass: bump this to invalidate every live hub session at once. */
  HUB_SESSION_GENERATION: string;
  HUB_ALLOWED_DOMAIN: string;
  HUB_PREVIEW_PASSCODE?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

// @astrojs/cloudflare exposes Pages env at locals.runtime.env. In dev/test
// locals.runtime is undefined → fall back to import.meta.env so misconfig
// degrades to a clean 503 rather than a crash.
export function readHubEnv(locals: unknown): HubEnv {
  const cf = (locals as { runtime?: { env?: Record<string, string> } })?.runtime?.env;
  const src = cf ?? (import.meta.env as unknown as Record<string, string>);
  return {
    GOOGLE_OAUTH_CLIENT_ID: src.GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET: src.GOOGLE_OAUTH_CLIENT_SECRET,
    HUB_SESSION_SECRET: src.HUB_SESSION_SECRET,
    HUB_SESSION_GENERATION: src.HUB_SESSION_GENERATION || '1',
    HUB_ALLOWED_DOMAIN: src.HUB_ALLOWED_DOMAIN || 'iastaffing.com',
    HUB_PREVIEW_PASSCODE: src.HUB_PREVIEW_PASSCODE,
    SUPABASE_URL: src.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: src.SUPABASE_SERVICE_ROLE_KEY,
  };
}
