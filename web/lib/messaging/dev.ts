import "server-only";
import { randomUUID } from "node:crypto";
import type { MessagingProvider } from "@/lib/messaging/provider";

/**
 * Delivers nothing. Every message is still recorded in `messages` (send.ts
 * does that whatever the provider) and readable at /staff/admin/dev-outbox,
 * which is how the channel is walked on a developer machine without a
 * WhatsApp Business account. Inbound events are simulated from that page,
 * not by a webhook: this adapter accepts no webhook at all.
 */
export const devMessagingProvider: MessagingProvider = {
  name: "dev",
  async sendTemplate(message) {
    console.info(`[whatsapp:dev] to=${message.to} template=${message.templateName}`);
    return { ok: true, providerMessageId: `dev-wa-${randomUUID()}` };
  },
  async verifyWebhook() {
    return null;
  },
};
