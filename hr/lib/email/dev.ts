import "server-only";
import { randomUUID } from "node:crypto";
import type { EmailProvider } from "@/lib/email/provider";

/**
 * Delivers nothing. Every message is still recorded in `email_messages`
 * (that happens in send.ts regardless of provider) and readable at
 * /staff/admin/dev-outbox, links included, which is how the whole parent
 * journey is walked on a developer machine without a mailbox.
 */
export const devProvider: EmailProvider = {
  name: "dev",
  async send(email) {
    console.info(`[email:dev] to=${email.to} subject="${email.subject}"`);
    return { ok: true, providerMessageId: `dev-${randomUUID()}` };
  },
  async verifyWebhook() {
    return null;
  },
};
