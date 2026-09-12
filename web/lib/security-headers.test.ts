import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce, NOINDEX_PATHS, securityHeaders } from "@/lib/security-headers";

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

  it("names the request's nonce, and trusts what that script loads", () => {
    const withNonce = directives(contentSecurityPolicy(ENV, { nonce: "AbC123==" }));
    expect(withNonce["script-src"]).toContain("'nonce-AbC123=='");
    // Without 'strict-dynamic' every chunk filename would need allow-listing.
    expect(withNonce["script-src"]).toContain("'strict-dynamic'");
    // Kept, and ignored by every browser that understands nonces. It is here
    // so a browser too old for either gets a working page rather than a blank
    // one; it buys such a browser no protection, and costs the rest none.
    expect(withNonce["script-src"]).toContain("'unsafe-inline'");
  });

  it("falls back to inline-permitting when no nonce is given", () => {
    // The shape a caller gets if it forgets the nonce: weaker, but a working
    // page rather than one with every script refused.
    expect(d["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
  });

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

  it("leaves the policy to the proxy, which is the only thing that knows the nonce", () => {
    // Two Content-Security-Policy headers are both enforced. A second one
    // here, without a nonce, would be a policy the nonce'd scripts also have
    // to satisfy — and the reason for the first one would be gone.
    expect(byKey["Content-Security-Policy"]).toBeUndefined();
  });

  it("covers every header a reviewer expects to find", () => {
    expect(Object.keys(byKey).sort()).toEqual([
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

describe("the nonce itself", () => {
  it("is different every time", () => {
    const many = new Set(Array.from({ length: 200 }, () => newNonce()));
    expect(many.size).toBe(200);
  });

  it("is base64 of sixteen bytes, which is 24 characters", () => {
    expect(newNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("carries the randomness it was given, rather than inventing any", () => {
    const fixed = () => new Uint8Array(16).fill(7);
    expect(newNonce(fixed)).toBe(Buffer.from(new Uint8Array(16).fill(7)).toString("base64"));
  });
});
