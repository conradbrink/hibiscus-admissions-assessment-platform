/**
 * The response headers every page and route carries.
 *
 * Written as a pure function of the environment so the policy can be read,
 * reviewed and unit tested in one place rather than inferred from a config
 * file. `next.config.ts` turns it into Next's `headers()` list.
 *
 * The policy is deliberately built from what this application actually talks
 * to, rather than copied from a template:
 *
 *   - the browser speaks to Supabase (sign-in, and the signed upload URL a
 *     registration document is sent straight to),
 *   - it speaks to Sentry when a DSN is configured,
 *   - it *posts a form* to the payment gateway — PayWeb wants the browser to
 *     submit the pay request id to `process.trans`, so `form-action` has to
 *     name the gateways or paying stops working,
 *   - it plays audio from a blob URL (the story narration the kiosk fetches),
 *   - it renders two previews in `<iframe srcdoc sandbox="">` (an email as it
 *     will be sent, a template as it will render), which is why `frame-src`
 *     is `'self'` rather than `'none'`.
 *
 * `script-src` is nonce-based. The proxy mints one random nonce per request,
 * puts it in the request's own CSP header — which is how Next is told to
 * stamp it on the scripts it injects — and in the response header the browser
 * enforces. An injected `<script>` cannot guess the nonce, so a stored XSS
 * has nothing to execute with.
 *
 * Three pieces of it are deliberate:
 *
 *   'strict-dynamic'  a script that carries the nonce may load the chunks it
 *                     needs. Without it every chunk filename would have to be
 *                     allow-listed, which is not a thing anybody maintains.
 *   'unsafe-inline'   ignored by every browser that understands nonces, which
 *                     is every browser that matters. It is here for a browser
 *                     old enough to understand neither, where the choice is
 *                     between a working page and a broken one.
 *   'self'            likewise ignored where 'strict-dynamic' applies.
 *
 * The nonce only reaches the HTML of a page Next renders per request, so the
 * root layout forces dynamic rendering. A prerendered page would carry the
 * build's HTML with no nonce in it and every script on it would be refused —
 * which is exactly what the enquiry form and the sign-in page did when this
 * was first tried.
 */

export type SecurityHeader = { key: string; value: string };

/** The payment gateways the browser is allowed to post a form to. */
const GATEWAY_FORM_TARGETS = ["https://secure.paygate.co.za", "https://secure.3gdirectpay.com"];

function originOf(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Sentry's DSN is a URL whose host is the ingest endpoint the browser posts to. */
function sentryOrigin(dsn: string | undefined): string | null {
  const origin = originOf(dsn);
  return origin;
}

export function contentSecurityPolicy(
  env: NodeJS.ProcessEnv = process.env,
  opts: { nonce?: string } = {}
): string {
  const supabase = originOf(env.NEXT_PUBLIC_SUPABASE_URL);
  const sentry = sentryOrigin(env.NEXT_PUBLIC_SENTRY_DSN);

  // Supabase realtime is a websocket to the same host.
  const supabaseSocket = supabase ? supabase.replace(/^https:/, "wss:") : null;

  const connect = ["'self'", supabase, supabaseSocket, sentry].filter(Boolean) as string[];
  const img = ["'self'", "data:", "blob:", supabase].filter(Boolean) as string[];

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    // Clickjacking: nothing may put the console or a parent page in a frame.
    ["frame-ancestors", ["'none'"]],
    // The sandboxed srcdoc previews are same-origin documents.
    ["frame-src", ["'self'"]],
    ["form-action", ["'self'", ...GATEWAY_FORM_TARGETS]],
    [
      "script-src",
      opts.nonce
        ? ["'self'", "'unsafe-inline'", `'nonce-${opts.nonce}'`, "'strict-dynamic'"]
        : ["'self'", "'unsafe-inline'"],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", img],
    ["font-src", ["'self'", "data:"]],
    // The kiosk plays narration from an object URL.
    ["media-src", ["'self'", "blob:", "data:"]],
    ["connect-src", connect],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["upgrade-insecure-requests", []],
  ];

  return directives
    .map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

/**
 * Everything else, and why:
 *
 *   HSTS            the whole product is authenticated by cookies; a single
 *                   plaintext request is a session handed over. Two years,
 *                   subdomains included, preload-ready.
 *   nosniff         a document the browser decides is HTML because the bytes
 *                   look like it is exactly the upload we refuse.
 *   Referrer-Policy magic links and kiosk codes appear in a URL for one
 *                   redirect; no third party needs the path, ever.
 *   Permissions     this application needs none of these devices. Saying so
 *                   stops anything embedded from asking on our behalf.
 *   X-Frame-Options the same as frame-ancestors for browsers that predate it.
 */
export function securityHeaders(env: NodeJS.ProcessEnv = process.env): SecurityHeader[] {
  // The CSP is built per request now, but this check stays here because this
  // is the function the build calls: a Supabase URL missing from the *build*
  // environment would still reach the browser as a `connect-src` that blocks
  // signing in, with nothing failing until somebody tried.
  if (!originOf(env.NEXT_PUBLIC_SUPABASE_URL)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL must be set (and a valid URL) when building: the Content-Security-Policy names it, and without it the browser cannot reach Supabase."
    );
  }
  return [
    // No Content-Security-Policy here: it carries a per-request nonce, so the
    // proxy sets it. A header in this list would be a second, nonce-less
    // policy enforced alongside it.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}

/**
 * Pages that must never be indexed, whatever a crawler finds. The public
 * enquiry form is deliberately not on this list: the school links to it.
 */
export const NOINDEX_PATHS = ["/staff/:path*", "/a/:path*", "/sit/:path*", "/family/:path*", "/next/:path*", "/offer/:path*", "/pay/:path*", "/register/:path*", "/profile/:path*"];

/**
 * A fresh nonce for one request. Base64 of 16 random bytes: unguessable, and
 * short enough not to bloat every script tag on the page.
 */
export function newNonce(random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(16))): string {
  return Buffer.from(random()).toString("base64");
}
