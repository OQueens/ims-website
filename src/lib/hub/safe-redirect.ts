// Resolve an untrusted `returnTo` into a safe, same-origin path under /hub.
// Parsing via the URL constructor normalizes `../` traversal and strips any
// scheme/host BEFORE the prefix check — so "/hub/../../etc" → "/etc" → rejected,
// "//evil.com" → "/" → rejected, and "https://evil.com/hub" → pathname "/hub"
// (host discarded). Returns only a pathname, never an absolute URL.
export function safeReturnTo(raw: string | null | undefined, fallback = '/hub'): string {
  if (!raw) return fallback;
  let path: string;
  try {
    path = new URL(raw, 'https://hub.invalid').pathname;
  } catch {
    return fallback;
  }
  return path === '/hub' || path.startsWith('/hub/') ? path : fallback;
}
