import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, NOINDEX_PATHS, securityHeaders } from "@/lib/security-headers";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://vzndqhghfaayhbuiaaga.supabase.co",
  NEXT_PUBLIC_SENTRY_DSN: "https://abc123@o4507.ingest.sentry.io/42",
} as unknown as NodeJS.ProcessEnv;

/** The directives, as a map, so a test can ask about one without a regex. */
function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    })
  );
}

describe("content security policy", () => {
  const d = directives(contentSecurityPolicy(ENV));

  it("refuses to be framed, and says so twice", () => {
    // The modern directive and the header older browsers read.
    expect(d["frame-ancestors"]).toEqual(["'none'"]);
    expect(securityHeaders(ENV).find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
  });

  it("allows no plugins and no base-tag rewrite", () => {
    expect(d["object-src"]).toEqual(["'none'"]);
    expect(d["base-uri"]).toEqual(["'self'"]);
  });

  it("lets a form reach the payment gateways and nowhere else", () => {
    // A form-action of 'self' alone would stop a parent paying: PayWeb wants
    // the browser to post the pay request id to process.trans.
    expect(d["form-action"]).toContain("'self'");
    expect(d["form-action"]).toContain("https://secure.paygate.co.za");
    expect(d["form-action"]).toContain("https://secure.3gdirectpay.com");
    expect(d["form-action"]).toHaveLength(3);
  });

  it("names the back ends the browser really talks to, and no others", () => {
    expect(d["connect-src"]).toEqual([
      "'self'",
      "https://vzndqhghfaayhbuiaaga.supabase.co",
      "wss://vzndqhghfaayhbuiaaga.supabase.co",
      "https://o4507.ingest.sentry.io",
    ]);
  });

  it("still loads scripts only from this origin", () => {
    // 'unsafe-inline' is present and deliberate (Next's inline bootstrap and
    // the gateway bridge). What must never appear is a foreign host or
    // 'unsafe-eval'.
    expect(d["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d["script-src"]).not.toContain("'unsafe-eval'");
    expect(contentSecurityPolicy(ENV)).not.toMatch(/script-src[^;]*\*(?!\.)/);
  });

  it("lets the kiosk play narration from a blob", () => {
    expect(d["media-src"]).toContain("blob:");
  });

  it("lets the sandboxed previews render", () => {
    // The email and template previews are <iframe srcdoc sandbox="">; a
    // frame-src of 'none' would blank them.
    expect(d["frame-src"]).toEqual(["'self'"]);
  });

  it("works when nothing is configured", () => {
    const bare = directives(contentSecurityPolicy({} as unknown as NodeJS.ProcessEnv));
    expect(bare["connect-src"]).toEqual(["'self'"]);
    expect(bare["default-src"]).toEqual(["'self'"]);
  });

  it("ignores an unparsable url rather than emitting it", () => {
    const odd = contentSecurityPolicy({ NEXT_PUBLIC_SUPABASE_URL: "not a url" } as unknown as NodeJS.ProcessEnv);
    expect(odd).not.toContain("not a url");
    expect(directives(odd)["connect-src"]).toEqual(["'self'"]);
  });
});

describe("the other headers", () => {
  const byKey = Object.fromEntries(securityHeaders(ENV).map((h) => [h.key, h.value]));

  it("pins https for two years, subdomains included", () => {
    expect(byKey["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
  });

  it("refuses content sniffing", () => {
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("never sends a path to another origin", () => {
    // A magic link and a kiosk code both sit in a URL for one redirect.
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("asks for no device the school does not use", () => {
    for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
      expect(byKey["Permissions-Policy"]).toContain(`${feature}=()`);
    }
  });

  it("refuses to build a policy that would block sign-in", () => {
    // The policy is baked at build time. A missing Supabase URL would produce
    // `connect-src 'self'` and a console nobody could sign in to.
    expect(() => securityHeaders({} as unknown as NodeJS.ProcessEnv)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() =>
      securityHeaders({ NEXT_PUBLIC_SUPABASE_URL: "not a url" } as unknown as NodeJS.ProcessEnv)
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("covers every header a reviewer expects to find", () => {
    expect(Object.keys(byKey).sort()).toEqual([
      "Content-Security-Policy",
      "Cross-Origin-Opener-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
    ]);
  });
});

describe("what search engines may index", () => {
  it("keeps every authenticated surface out of the index", () => {
    for (const path of ["/staff/:path*", "/a/:path*", "/sit/:path*", "/family/:path*"]) {
      expect(NOINDEX_PATHS).toContain(path);
    }
  });

  it("leaves the public enquiry form indexable", () => {
    // The school links to /join from its website; a noindex there would be a
    // security control applied to the one page that wants to be found.
    expect(NOINDEX_PATHS.some((p) => p.startsWith("/join"))).toBe(false);
  });
});
