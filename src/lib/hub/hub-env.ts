// Both IMS-brand Workspace domains may access the hub. Override via the
// HUB_ALLOWED_DOMAIN env (comma-separated) to add/remove domains without a deploy.
export const DEFAULT_ALLOWED_DOMAINS: readonly string[] = ['iastaffing.com', 'imstaffing.ai'];

// Conservative hostname check: dot-separated labels (each starting/ending
// alphanumeric), TLD >= 2 letters. Rejects '*', '.com', 'localhost', and junk so
// a typo'd env can't silently lock everyone out or widen the allowlist.
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/** Parse a comma-separated HUB_ALLOWED_DOMAIN env into a normalized, validated
 *  list, falling back to both IMS domains when unset/empty/all-invalid. */
export function parseAllowedDomains(raw?: string): string[] {
  const parsed = (raw ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => DOMAIN_RE.test(d));
  return parsed.length ? parsed : [...DEFAULT_ALLOWED_DOMAINS];
}

export interface HubEnv {
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  HUB_SESSION_SECRET?: string;
  /** Break-glass: bump this to invalidate every live hub session at once. */
  HUB_SESSION_GENERATION: string;
  /** Email domains permitted to sign in to the hub (Google Workspace). */
  HUB_ALLOWED_DOMAINS: string[];
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
    HUB_ALLOWED_DOMAINS: parseAllowedDomains(src.HUB_ALLOWED_DOMAIN),
    HUB_PREVIEW_PASSCODE: src.HUB_PREVIEW_PASSCODE,
    SUPABASE_URL: src.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: src.SUPABASE_SERVICE_ROLE_KEY,
  };
}
