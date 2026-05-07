import { describe, it, expect } from "vitest";
import {
  buildCanonicalRedirect,
  applySecurityHeaders,
  SECURITY_HEADERS,
  PAGES_DEV_HOSTNAME,
  CANONICAL_HOSTNAME,
} from "./middleware-logic";

describe("buildCanonicalRedirect", () => {
  it("redirects exact-match ims-website.pages.dev/ → innovativemedicalstaffing.com/", () => {
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
  it("includes Phase 1.0 noindex via X-Robots-Tag", () => {
    expect(SECURITY_HEADERS["X-Robots-Tag"]).toBe("noindex, nofollow");
  });

  it("includes a strict CSP with default-src 'none'", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain(
      "default-src 'none'",
    );
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
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
