import * as Sentry from "@sentry/nextjs";
import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { afterAll, describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, sharedSentryOptions } from "@/lib/monitoring";

/**
 * What leaves for Sentry. This system holds children's names, dates of birth
 * and identity numbers, and Sentry is a third party, so these are checked
 * twice: the scrubbers on their own, and the real SDK end to end, because a
 * major SDK upgrade can change when the hooks run or what is attached by
 * default without changing a single type.
 */

const event = (o: Partial<ErrorEvent> = {}): ErrorEvent => ({ type: undefined, environment: "production", ...o }) as ErrorEvent;

describe("scrubEvent", () => {
  it("drops everything raised outside production", () => {
    expect(scrubEvent(event({ environment: "development" }))).toBeNull();
    expect(scrubEvent(event({ environment: "preview" }))).toBeNull();
  });

  it("removes credentials and personal fields at every depth of extra", () => {
    const out = scrubEvent(event({ extra: { applicationId: "a1", access_token: "t", body: { child: { date_of_birth: "2015-01-01", identity_number: "123" } } } }));
    expect(out?.extra).toEqual({ applicationId: "a1", access_token: "[redacted]", body: { child: { date_of_birth: "[redacted]", identity_number: "[redacted]" } } });
  });

  it("strips cookies, the query string, auth headers and the token in a magic-link path", () => {
    const out = scrubEvent(
      event({
        request: {
          url: "https://admissions.example/a/SECRET-TOKEN?next=/x",
          query_string: "token=abc",
          cookies: { sb: "session" },
          headers: { authorization: "Bearer x", cookie: "sb=1", "x-supabase-auth": "y", accept: "text/html" },
        },
      })
    );
    expect(out?.request?.url).toBe("https://admissions.example/a/[masked]");
    expect(out?.request?.headers).toEqual({ accept: "text/html" });
    expect(out?.request).not.toHaveProperty("query_string");
    expect(out?.request).not.toHaveProperty("cookies");
  });
});

describe("scrubBreadcrumb", () => {
  it("masks credential paths and query strings in navigation and fetch breadcrumbs", () => {
    const out = scrubBreadcrumb({ category: "navigation", data: { from: "/sit/ABC123?x=1", to: "/a/TOKEN", url: "/api?apikey=1", password: "p" } } as Breadcrumb);
    expect(out?.data).toEqual({ from: "/sit/[masked]", to: "/a/[masked]", url: "/api", password: "[redacted]" });
  });
});

describe("the Sentry SDK with the shared options", () => {
  type Envelope = [Record<string, unknown>, Array<[{ type: string }, unknown]>];
  const sent: Envelope[] = [];

  // A transport that keeps envelopes in memory: nothing goes over the network.
  Sentry.init({
    ...sharedSentryOptions,
    dsn: "https://public@o0.ingest.sentry.io/0",
    environment: "production",
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(envelope as unknown as Envelope);
        return {};
      },
      flush: async () => true,
    }),
  });

  afterAll(async () => {
    await Sentry.close(1000);
  });

  const lastEvent = () => {
    const items = sent.flatMap(([, list]) => list).filter(([h]) => h.type === "event");
    return items.at(-1)?.[1] as ErrorEvent | undefined;
  };

  it("still runs beforeSend: personal and credential fields never leave the process", async () => {
    Sentry.captureException(new Error("boom"), { extra: { applicationId: "a1", nested: { date_of_birth: "2015-01-01", access_token: "t" } } });
    await Sentry.flush(1000);
    const sentEvent = lastEvent();
    expect(sentEvent).toBeDefined();
    expect(sentEvent?.extra).toEqual({ applicationId: "a1", nested: { date_of_birth: "[redacted]", access_token: "[redacted]" } });
  });

  it("sends no value that exists only at runtime: no local variables, nothing beyond the scrubbed extra", async () => {
    // Made at runtime so it cannot appear in the source lines Sentry attaches
    // around a frame (those are code, and are expected). If it shows up
    // anywhere in the envelope, the SDK captured data: local variables, which
    // would carry a child's name, are the default to watch across upgrades.
    const childName = `child-${crypto.randomUUID()}`;
    try {
      throw new Error(`failed for ${childName.length} characters`);
    } catch (e) {
      Sentry.captureException(e, { extra: { name_of_child_field: { date_of_birth: childName } } });
    }
    await Sentry.flush(1000);
    expect(JSON.stringify(sent)).not.toContain(childName);
    const frames = lastEvent()?.exception?.values?.flatMap((v) => v.stacktrace?.frames ?? []) ?? [];
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((f) => f.vars !== undefined)).toBe(false);
  });

  it("attaches no IP address, cookies or user by default", async () => {
    Sentry.captureException(new Error("boom again"));
    await Sentry.flush(1000);
    const sentEvent = lastEvent();
    expect(sentEvent?.user?.ip_address ?? null).toBeNull();
    expect(sentEvent?.request?.cookies).toBeUndefined();
  });

  it("collects no personal data categories: the SDK's resolved settings, not just what was passed", () => {
    // Sentry 11 removed `sendDefaultPii` (passing it does nothing) and turned
    // every data category on by default: user info and IP addresses, cookies,
    // request and response bodies, local variables in stack frames. These are
    // the settings the SDK actually resolved from `sharedSentryOptions`.
    const collected = Sentry.getClient()?.getDataCollectionOptions();
    expect(collected).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    });
    for (const direction of ["request", "response"] as const) {
      const rule = collected?.httpHeaders[direction];
      expect(rule === false || (typeof rule === "object" && "deny" in rule && ["cookie", "authorization", "x-supabase-auth"].every((h) => rule.deny.includes(h)))).toBe(true);
    }
  });

  it("still runs beforeBreadcrumb on breadcrumbs attached to an event", async () => {
    Sentry.addBreadcrumb({ category: "navigation", data: { to: "/a/MAGIC-LINK-TOKEN" } });
    Sentry.captureException(new Error("after navigation"));
    await Sentry.flush(1000);
    const crumbs = JSON.stringify(lastEvent()?.breadcrumbs ?? []);
    expect(crumbs).toContain("/a/[masked]");
    expect(crumbs).not.toContain("MAGIC-LINK-TOKEN");
  });
});
