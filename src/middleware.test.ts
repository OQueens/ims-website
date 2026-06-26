import { describe, it, expect } from "vitest";
import {
  buildCanonicalRedirect,
  buildTrailingSlashRedirect,
  applySecurityHeaders,
  SECURITY_HEADERS,
  HUB_SECURITY_HEADERS,
  PAGES_DEV_HOSTNAME,
  CANONICAL_HOSTNAME,
  CAREERS_LANDING_PATH,
} from "./middleware-logic";

describe("buildCanonicalRedirect", () => {
  it("pins the canonical host to imstaffing.ai (post 2026-06-11 flip)", () => {
    expect(CANONICAL_HOSTNAME).toBe("imstaffing.ai");
  });

  it("redirects exact-match ims-website.pages.dev/ → imstaffing.ai/", () => {
    const r = buildCanonicalRedirect(`https://${PAGES_DEV_HOSTNAME}/`);
    expect(r).not.toBeNull();
    expect(r!.status).toBe(301);
    expect(r!.headers.get("Location")).toBe(`https://${CANONICAL_HOSTNAME}/`);
  });

  it("preserves path and query when redirecting", () => {
    const r = buildCanonicalRedirect(
      `https://${PAGES_DEV_HOSTNAME}/jobs?specialty=anesthesiology`,
    );
    expect(r).not.toBeNull();
    expect(r!.headers.get("Location")).toBe(
      `https://${CANONICAL_HOSTNAME}/jobs?specialty=anesthesiology`,
    );
  });

  // ── Canonical FLIP: the retired primary domain 301s to imstaffing.ai ──
  it("redirects legacy innovativemedicalstaffing.com/ → imstaffing.ai/", () => {
    const r = buildCanonicalRedirect("https://innovativemedicalstaffing.com/");
    expect(r).not.toBeNull();
    expect(r!.status).toBe(301);
    expect(r!.headers.get("Location")).toBe("https://imstaffing.ai/");
  });

  it("redirects legacy domain preserving deep path + query", () => {
    const r = buildCanonicalRedirect(
      "https://innovativemedicalstaffing.com/jobs/crna-texas?ref=email",
    );
    expect(r!.headers.get("Location")).toBe(
      "https://imstaffing.ai/jobs/crna-texas?ref=email",
    );
  });

  it("redirects www.innovativemedicalstaffing.com → imstaffing.ai", () => {
    const r = buildCanonicalRedirect(
      "https://www.innovativemedicalstaffing.com/about",
    );
    expect(r!.headers.get("Location")).toBe("https://imstaffing.ai/about");
  });

  it("redirects www.imstaffing.ai → apex imstaffing.ai", () => {
    const r = buildCanonicalRedirect("https://www.imstaffing.ai/contact");
    expect(r).not.toBeNull();
    expect(r!.headers.get("Location")).toBe("https://imstaffing.ai/contact");
  });

  // ── Careers domain → job board (lands directly on the trailing-slash canonical
  //    form so the careers entry is a single hop, not careers→/jobs→/jobs/) ──
  // Bind to CAREERS_LANDING_PATH so reverting that constant (e.g. /jobs/ → /jobs)
  // FAILS the test — the exact trailing-slash regression D2 locks in.
  it("redirects imstaffing.careers/ root → imstaffing.ai + CAREERS_LANDING_PATH (trailing slash)", () => {
    expect(CAREERS_LANDING_PATH).toBe("/jobs/");
    const r = buildCanonicalRedirect("https://imstaffing.careers/");
    expect(r).not.toBeNull();
    expect(r!.status).toBe(301);
    expect(r!.headers.get("Location")).toBe(`https://imstaffing.ai${CAREERS_LANDING_PATH}`);
  });

  it("redirects www.imstaffing.careers/ root → imstaffing.ai + CAREERS_LANDING_PATH", () => {
    const r = buildCanonicalRedirect("https://www.imstaffing.careers/");
    expect(r!.headers.get("Location")).toBe(`https://imstaffing.ai${CAREERS_LANDING_PATH}`);
  });

  it("preserves careers deep paths onto canonical (no forced /jobs)", () => {
    const r = buildCanonicalRedirect(
      "https://imstaffing.careers/jobs/anesthesiology-fl?ref=ad",
    );
    expect(r!.headers.get("Location")).toBe(
      "https://imstaffing.ai/jobs/anesthesiology-fl?ref=ad",
    );
  });

  // ── API routes must NEVER be 301'd, on ANY host. The live LocumSmart webhook
  //    POSTs to innovativemedicalstaffing.com/api/locumsmart-events and does not
  //    follow redirects — a 301 would silently kill job-board + ls_events ingest.
  it("does NOT redirect the LocumSmart webhook on the legacy host", () => {
    const r = buildCanonicalRedirect(
      "https://innovativemedicalstaffing.com/api/locumsmart-events",
    );
    expect(r).toBeNull();
  });

  it("does NOT redirect /api/* on any redirect-source host (legacy, www, pages.dev, careers)", () => {
    for (const u of [
      "https://innovativemedicalstaffing.com/api/contact",
      "https://www.innovativemedicalstaffing.com/api/apply",
      `https://${PAGES_DEV_HOSTNAME}/api/locumsmart-events`,
      "https://www.imstaffing.ai/api/contact",
      "https://imstaffing.careers/api/locumsmart-events",
    ]) {
      expect(buildCanonicalRedirect(u)).toBeNull();
    }
  });

  it("still redirects NON-api paths that merely contain 'api' in a segment", () => {
    // Guard against an over-broad match: /apiary or /capital must still flip.
    const r = buildCanonicalRedirect("https://innovativemedicalstaffing.com/apiary");
    expect(r).not.toBeNull();
    expect(r!.headers.get("Location")).toBe("https://imstaffing.ai/apiary");
  });

  it("does NOT redirect preview deploys (<hash>.ims-website.pages.dev)", () => {
    const r = buildCanonicalRedirect(
      `https://abc123.${PAGES_DEV_HOSTNAME}/`,
    );
    expect(r).toBeNull();
  });

  it("does NOT redirect when already on canonical host", () => {
    const r = buildCanonicalRedirect(`https://${CANONICAL_HOSTNAME}/`);
    expect(r).toBeNull();
  });

  it("does NOT redirect arbitrary hosts", () => {
    const r = buildCanonicalRedirect("https://example.com/foo");
    expect(r).toBeNull();
  });

  it("forces HTTPS even if request arrived over HTTP", () => {
    const r = buildCanonicalRedirect(`http://${PAGES_DEV_HOSTNAME}/`);
    expect(r).not.toBeNull();
    expect(r!.headers.get("Location")).toBe(`https://${CANONICAL_HOSTNAME}/`);
  });

  it("attaches all SECURITY_HEADERS on the redirect response", () => {
    const r = buildCanonicalRedirect(`https://${PAGES_DEV_HOSTNAME}/`);
    expect(r).not.toBeNull();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(r!.headers.get(name)).toBe(value);
    }
  });

  it("attaches SECURITY_HEADERS on legacy + careers redirects too", () => {
    for (const u of [
      "https://innovativemedicalstaffing.com/",
      "https://imstaffing.careers/",
    ]) {
      const r = buildCanonicalRedirect(u);
      expect(r).not.toBeNull();
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(r!.headers.get(name)).toBe(value);
      }
    }
  });
});

describe("buildTrailingSlashRedirect", () => {
  const CANON = `https://${CANONICAL_HOSTNAME}`;

  it("301s a slash-less SSR page to its trailing-slash canonical form (GET)", () => {
    const r = buildTrailingSlashRedirect(`${CANON}/jobs`, "GET");
    expect(r).not.toBeNull();
    expect(r!.status).toBe(301);
    expect(r!.headers.get("Location")).toBe(`${CANON}/jobs/`);
  });

  it("301s a slash-less job-detail path (the /jobs/<uuid> email link form)", () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const r = buildTrailingSlashRedirect(`${CANON}/jobs/${uuid}`, "GET");
    expect(r!.headers.get("Location")).toBe(`${CANON}/jobs/${uuid}/`);
  });

  it("301s /contact → /contact/", () => {
    const r = buildTrailingSlashRedirect(`${CANON}/contact`, "GET");
    expect(r!.headers.get("Location")).toBe(`${CANON}/contact/`);
  });

  it("preserves the query string when adding the slash", () => {
    const r = buildTrailingSlashRedirect(`${CANON}/jobs?q=crna&state=tx`, "GET");
    expect(r!.headers.get("Location")).toBe(`${CANON}/jobs/?q=crna&state=tx`);
  });

  it("redirects on the request's own host (preview deploys behave like prod)", () => {
    const r = buildTrailingSlashRedirect(`https://abc123.${PAGES_DEV_HOSTNAME}/jobs`, "GET");
    expect(r!.headers.get("Location")).toBe(`https://abc123.${PAGES_DEV_HOSTNAME}/jobs/`);
  });

  it("does NOT redirect the root path (no slash to add, no loop)", () => {
    expect(buildTrailingSlashRedirect(`${CANON}/`, "GET")).toBeNull();
  });

  it("does NOT redirect a path that already ends in a slash (loop guard)", () => {
    expect(buildTrailingSlashRedirect(`${CANON}/jobs/`, "GET")).toBeNull();
    expect(buildTrailingSlashRedirect(`${CANON}/contact/`, "GET")).toBeNull();
  });

  // ── The whole reason this lives in middleware instead of Astro's global
  //    `trailingSlash: 'always'`: Astro would 308 EVERY on-demand route incl.
  //    /api inside App.render BEFORE middleware runs, silently killing the live
  //    LocumSmart webhook (which does not follow redirects). /api stays exempt. ──
  it("does NOT redirect /api/* (webhook + form endpoints must never be slash-redirected)", () => {
    expect(buildTrailingSlashRedirect(`${CANON}/api/contact`, "GET")).toBeNull();
    expect(buildTrailingSlashRedirect(`${CANON}/api/locumsmart-events`, "GET")).toBeNull();
    expect(buildTrailingSlashRedirect(`${CANON}/api/locumsmart-events`, "POST")).toBeNull();
  });

  it("does NOT redirect the bare /api segment (no /api index route — avoid a 301→404)", () => {
    expect(buildTrailingSlashRedirect(`${CANON}/api`, "GET")).toBeNull();
  });

  it("does NOT redirect the internal /hub surface (OAuth, /hub/api, noindex)", () => {
    expect(buildTrailingSlashRedirect(`${CANON}/hub`, "GET")).toBeNull();
    expect(buildTrailingSlashRedirect(`${CANON}/hub/login`, "GET")).toBeNull();
    expect(buildTrailingSlashRedirect(`${CANON}/hub/auth/callback`, "GET")).toBeNull();
    expect(buildTrailingSlashRedirect(`${CANON}/hub/api/sync`, "GET")).toBeNull();
  });

  it("only redirects safe body-less navigations (never POST/PUT/DELETE/PATCH/OPTIONS to a page route)", () => {
    for (const m of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      expect(buildTrailingSlashRedirect(`${CANON}/jobs`, m)).toBeNull();
    }
    // HEAD mirrors GET (crawlers/health checks).
    const head = buildTrailingSlashRedirect(`${CANON}/jobs`, "HEAD");
    expect(head!.status).toBe(301);
    expect(head!.headers.get("Location")).toBe(`${CANON}/jobs/`);
  });

  it("does NOT redirect file-like asset paths (defense-in-depth)", () => {
    expect(buildTrailingSlashRedirect(`${CANON}/favicon.svg`, "GET")).toBeNull();
    expect(buildTrailingSlashRedirect(`${CANON}/sitemap-index.xml`, "GET")).toBeNull();
  });

  it("does not match a segment that merely contains 'api'/'hub' (e.g. /apiary, /hubbub)", () => {
    expect(buildTrailingSlashRedirect(`${CANON}/apiary`, "GET")!.headers.get("Location")).toBe(`${CANON}/apiary/`);
    expect(buildTrailingSlashRedirect(`${CANON}/hubbub`, "GET")!.headers.get("Location")).toBe(`${CANON}/hubbub/`);
  });

  it("attaches all SECURITY_HEADERS on the redirect response", () => {
    const r = buildTrailingSlashRedirect(`${CANON}/jobs`, "GET");
    expect(r).not.toBeNull();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(r!.headers.get(name)).toBe(value);
    }
  });
});

describe("applySecurityHeaders", () => {
  it("adds every SECURITY_HEADERS entry to the response", () => {
    const upstream = new Response("ok", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
    const out = applySecurityHeaders(upstream);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(out.headers.get(name)).toBe(value);
    }
  });

  it("preserves status and existing headers from upstream", () => {
    const upstream = new Response("ok", {
      status: 418,
      headers: { "Content-Type": "text/html", "X-Custom": "preserved" },
    });
    const out = applySecurityHeaders(upstream);
    expect(out.status).toBe(418);
    expect(out.headers.get("Content-Type")).toBe("text/html");
    expect(out.headers.get("X-Custom")).toBe("preserved");
  });

  it("overrides upstream values for SECURITY_HEADERS keys (defense-in-depth)", () => {
    const upstream = new Response("ok", {
      status: 200,
      headers: { "X-Frame-Options": "ALLOW-FROM evil.example" },
    });
    const out = applySecurityHeaders(upstream);
    expect(out.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

describe("SECURITY_HEADERS contents", () => {
  it("no longer carries X-Robots-Tag (LAUNCH HARD GATE FLIPPED — T14)", () => {
    // Phase 1.A LAUNCH paired with T15+T16+T28: the de-indexing header was
    // intentionally dropped from SECURITY_HEADERS in src/middleware-logic.ts.
    // Reintroducing it would silently de-index the live site. The matching
    // regression guard in scripts/verify-build.mjs catches it at the
    // bundled-output level; this unit test catches it at the source level.
    expect(SECURITY_HEADERS["X-Robots-Tag"]).toBeUndefined();
  });

  it("includes a strict CSP with default-src 'self' + Plausible/Turnstile allowlists", () => {
    const csp = SECURITY_HEADERS["Content-Security-Policy"];
    // Phase 1.A spec §0.5.3 — replaces the Phase 1.0 'none' default.
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' https://plausible.io https://challenges.cloudflare.com",
    );
    expect(csp).toContain(
      "connect-src 'self' https://plausible.io https://challenges.cloudflare.com",
    );
    expect(csp).toContain("frame-src https://challenges.cloudflare.com");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("form-action 'self'");
    // frame-ancestors stays at 'none' — clickjacking defense persists.
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("allows the Firebase RTDB connect-src ONLY on the hub (least-privilege scope)", () => {
    // The hub Rate Simulator's client lazy-loads firebase/database and reads the
    // live market overlay from weekly-sync-451e2's RTDB over a WebSocket. That host
    // MUST be in connect-src on the hub or the browser blocks the read and the sim
    // silently falls back to static rates. Wildcard: firebase shards RTDB across
    // regional hosts (s-gke-*.firebaseio.com) the project host redirects the socket
    // to (browser-verified 2026-06-26). SCOPED to /hub — the marketing site never
    // loads firebase, so its CSP stays tight (max-security directive 2026-06-26).
    const hubCsp = HUB_SECURITY_HEADERS["Content-Security-Policy"];
    expect(hubCsp).toContain("wss://*.firebaseio.com");
    expect(hubCsp).toContain("https://*.firebaseio.com");
    // The default (marketing) CSP must NOT widen connect-src to firebase.
    const baseCsp = SECURITY_HEADERS["Content-Security-Policy"];
    expect(baseCsp).not.toContain("firebaseio.com");
  });

  it("applySecurityHeaders emits the firebase-allowing CSP only when hub:true", () => {
    const base = applySecurityHeaders(new Response("x"));
    expect(base.headers.get("Content-Security-Policy")).not.toContain("firebaseio.com");
    const hub = applySecurityHeaders(new Response("x"), { hub: true });
    expect(hub.headers.get("Content-Security-Policy")).toContain("wss://*.firebaseio.com");
  });

  it("includes HSTS with includeSubDomains", () => {
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toContain(
      "includeSubDomains",
    );
  });

  it("denies framing via X-Frame-Options DENY", () => {
    expect(SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });
});
