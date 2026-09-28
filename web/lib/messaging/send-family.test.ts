import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";
import { sendFamilyMessage } from "@/lib/messaging/send";

/**
 * A campaign fills a template's parameters from its own mapping, so one it
 * forgot to map arrives empty. The family sender must skip that parent,
 * naming the missing value, before it mints a link or reaches the provider:
 * never send "…our Social Evening is , at …".
 *
 * A hand-rolled Supabase double, like the others here. It answers by table
 * and records every table touched and every `messages` row written, so the
 * assertions can say what did not happen as well as what did.
 */
function double(template: Record<string, unknown>) {
  const touched: string[] = [];
  const messageRows: Record<string, unknown>[] = [];
  const answers: Record<string, unknown> = {
    settings: [{ key: "whatsapp_enabled", value: true }],
    message_templates: template,
    contacts: { id: "contact-1", first_name: "Neo", mobile_normalised: "+26771234567", whatsapp_opt_in: true },
    messages: { id: "message-1" },
    access_tokens: { id: "token-1" },
  };
  const admin = {
    from(table: string) {
      touched.push(table);
      const result = { data: answers[table] ?? null, error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "limit", "update", "insert"]) chain[m] = () => chain;
      chain.upsert = (row: Record<string, unknown>) => {
        if (table === "messages") messageRows.push(row);
        return chain;
      };
      chain.maybeSingle = async () => result;
      chain.single = async () => result;
      chain.then = (resolve: (v: unknown) => void) => resolve(result);
      return chain;
    },
  } as unknown as AdminClient;
  return { admin, touched, messageRows };
}

const eventReminder = {
  key: "event_reminder",
  is_active: true,
  meta_template_name: "event_reminder",
  body_preview: "Hi {{1}}, a friendly reminder that our {{2}} is {{3}}, at {{4}}. We look forward to seeing you there.",
  parameters: ["parent_first_name", "event_name", "event_when", "event_location"],
  // A button, so a link would be minted if the check came too late.
  button_link: true,
  link_purpose: "event",
};

const send = (admin: AdminClient, variables: Record<string, string | null>) =>
  sendFamilyMessage(admin, {
    familyId: "family-1",
    contactId: "contact-1",
    templateKey: "event_reminder",
    idempotencyKey: "campaign:c-1:contact-1:whatsapp",
    variables,
    link: "event",
    trigger: "campaign",
  });

describe("sendFamilyMessage with a parameter left empty", () => {
  const provider = process.env.MESSAGING_PROVIDER;
  beforeEach(() => {
    delete process.env.MESSAGING_PROVIDER;
    // A minted link is built on the site's address.
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://admissions.example.test");
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    if (provider === undefined) delete process.env.MESSAGING_PROVIDER;
    else process.env.MESSAGING_PROVIDER = provider;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("skips the parent, naming what is missing, before any link is minted", async () => {
    const { admin, touched, messageRows } = double(eventReminder);
    const result = await send(admin, { event_name: "Parents' Social Evening", event_when: "", event_location: "Broadhurst" });

    expect(result).toEqual({ status: "skipped", reason: 'the "event_reminder" template needs event_when, which is not set' });
    expect(touched).not.toContain("access_tokens");
    expect(messageRows.map((r) => r.status)).toEqual(["skipped"]);
  });

  it("treats a value that was never mapped the same as an empty one", async () => {
    const { admin, touched } = double(eventReminder);
    const result = await send(admin, { event_name: "Parents' Social Evening" });

    expect(result.status).toBe("skipped");
    expect(result.status === "skipped" && result.reason).toContain("event_when, event_location, which are not set");
    expect(touched).not.toContain("access_tokens");
  });

  it("sends when every parameter is filled, link and all", async () => {
    const { admin, touched, messageRows } = double(eventReminder);
    const result = await send(admin, {
      event_name: "Parents' Social Evening",
      event_when: "tonight from 18:30",
      event_location: "Broadhurst",
    });

    expect(result.status).toBe("sent");
    expect(touched).toContain("access_tokens");
    expect(messageRows[0]).toMatchObject({
      status: "queued",
      rendered_text: expect.stringContaining("our Parents' Social Evening is tonight from 18:30, at Broadhurst."),
    });
  });
});
