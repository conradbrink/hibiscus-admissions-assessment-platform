import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";

/**
 * Shared Sentry configuration for the browser and the server.
 *
 * Kept in one place so the two runtimes cannot drift. Ported from the
 * merchandising app, where the scrubbing rules were learned one leak at a time.
 *
 * ## What is deliberately not sent
 *
 * This system holds children's names, dates of birth, and — from Phase 3 —
 * medical information and identity numbers. Sentry is a third party.
 *
 *   * `sendDefaultPii: false` — no IPs, no cookies, no usernames attached
 *     automatically.
 *   * {@link scrubEvent} removes credential-shaped values from headers, query
 *     strings and extra data before anything leaves the process.
 *   * Tracing and replay are off. Replay records the screen, and these screens
 *     show a child's assessment results.
 *
 * ⚠️ Magic-link tokens travel in the URL path once (`/a/<token>`). The
 * breadcrumb scrubber strips query strings but not paths, so
 * {@link scrubBreadcrumb} also masks that path shape explicitly.
 */

/** Header names that must never reach Sentry. */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "apikey",
  "cookie",
  "set-cookie",
  "x-supabase-auth",
]);

/** Any key containing one of these is redacted, wherever it appears. */
const SENSITIVE_KEY_PARTS = [
  "password",
  "token",
  "secret",
  "apikey",
  "api_key",
  "service_role",
  "authorization",
  // Domain-specific: never let these ride along as "extra".
  "date_of_birth",
  "dob",
  "identity_number",
  "medical",
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

/**
 * Redacts sensitive keys **at every depth**.
 *
 * A shallow pass looks correct and is not: payloads nest, so
 * `{ body: { access_token: "…" } }` walks straight past a top-level check.
 */
function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSensitiveKey(k) ? "[redacted]" : scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

function scrubRecord(
  input: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!input) return input;
  return scrubValue(input) as Record<string, unknown>;
}

/** `/a/<token>` and `/sit/<code>` carry a credential in the path. */
const CREDENTIAL_PATH = /\/(a|sit)\/[^/?#]+/g;

function maskUrl(url: string): string {
  return url.split("?")[0].replace(CREDENTIAL_PATH, "/$1/[masked]");
}

/**
 * Last thing that runs before an event is sent.
 *
 * Returning null drops the event entirely, which is what happens for anything
 * raised outside production — a developer's laptop must not post into the
 * stream the school watches.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.environment !== "production") return null;

  if (event.request) {
    if (event.request.headers) {
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.request.headers)) {
        if (!SENSITIVE_HEADERS.has(k.toLowerCase()) && !isSensitiveKey(k)) {
          headers[k] = v;
        }
      }
      event.request.headers = headers;
    }
    if (typeof event.request.url === "string") {
      event.request.url = maskUrl(event.request.url);
    }
    delete event.request.query_string;
    delete event.request.cookies;
  }

  event.extra = scrubRecord(event.extra);

  return event;
}

/** Options shared by every runtime. */
export const sharedSentryOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
} as const;

/**
 * Records a business operation for context.
 *
 * Breadcrumbs, not alerts — they attach to whatever error happens next.
 *
 * ⚠️ Pass identifiers and counts, never content. An application id is fine; a
 * child's name, a date of birth or an email address is not.
 */
export function recordEvent(
  name: string,
  data?: Record<string, unknown>
): void {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  void import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.addBreadcrumb({
        category: "business",
        message: name,
        level: "info",
        data: scrubRecord(data),
      });
    })
    // Never let recording a breadcrumb become the error.
    .catch(() => {});
}

/**
 * Scrubs Sentry's own automatic breadcrumbs: every `fetch`, every navigation,
 * every `console` call.
 */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.data) {
    const data = scrubRecord(breadcrumb.data as Record<string, unknown>) ?? {};
    if (typeof data.url === "string") data.url = maskUrl(data.url);
    if (typeof data.to === "string") data.to = maskUrl(data.to);
    if (typeof data.from === "string") data.from = maskUrl(data.from);
    breadcrumb.data = data;
  }
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = maskUrl(breadcrumb.message);
  }
  return breadcrumb;
}
