import "server-only";

/**
 * The seam between this system and whoever delivers its WhatsApp messages.
 *
 * Nothing outside lib/messaging imports a vendor SDK or knows a provider's
 * name. The production adapter is chosen by MESSAGING_PROVIDER; unset means
 * `dev`, which delivers nothing and records everything, so a misconfigured
 * deploy cannot message real parents.
 *
 * Only templates are sent. WhatsApp allows free text solely inside a
 * 24-hour reply window, and free text would put wording in code; so the
 * contract is "this approved template, these parameter values".
 */

export type OutboundTemplateMessage = {
  /** E.164, with the leading plus. */
  to: string;
  templateName: string;
  language: string;
  /** Values for {{1}}…{{n}}, in order, already sanitised. */
  bodyParams: string[];
  /** The dynamic suffix for the template's URL button, when it has one. */
  buttonUrlSuffix?: string | null;
  idempotencyKey: string;
};

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

export type InboundEvent =
  | { kind: "status"; providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; error?: string | null; occurredAt: Date }
  | { kind: "text"; providerMessageId: string; from: string; text: string; occurredAt: Date };

export interface MessagingProvider {
  readonly name: string;
  sendTemplate(message: OutboundTemplateMessage): Promise<SendResult>;
  /**
   * Verifies a webhook and returns the events it carries, or null when the
   * signature does not check out. A null must be answered with a 401.
   */
  verifyWebhook(rawBody: string, headers: Headers): Promise<InboundEvent[] | null>;
}

export async function getMessagingProvider(): Promise<MessagingProvider> {
  const which = (process.env.MESSAGING_PROVIDER ?? "dev").toLowerCase();
  switch (which) {
    case "meta": {
      const { MetaWhatsAppProvider } = await import("@/lib/messaging/meta");
      return new MetaWhatsAppProvider();
    }
    case "dev":
      return (await import("@/lib/messaging/dev")).devMessagingProvider;
    default:
      throw new Error(`Unknown MESSAGING_PROVIDER "${which}". Use "dev" or "meta".`);
  }
}
