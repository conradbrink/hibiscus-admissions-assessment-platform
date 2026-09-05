import "server-only";

/**
 * The seam between this system and whoever delivers its email.
 *
 * Nothing outside lib/email imports a vendor SDK or knows a provider's name.
 * The production adapter is chosen by EMAIL_PROVIDER; unset means `dev`,
 * which delivers nothing and records everything, so a misconfigured deploy
 * cannot email real parents.
 */

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-side idempotency, where supported. */
  idempotencyKey?: string;
  /** A calendar invitation (text) or a receipt PDF (bytes). */
  attachments?: Array<{ filename: string; content: string | Uint8Array; contentType: string }>;
};

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

export type DeliveryEvent = {
  providerMessageId: string;
  kind: "delivered" | "opened" | "clicked" | "bounced" | "complained";
  occurredAt: Date;
};

export interface EmailProvider {
  readonly name: string;
  send(email: OutboundEmail): Promise<SendResult>;
  /**
   * Verifies a webhook and returns the events it carries, or null when the
   * signature does not check out. A null must be answered with a 401.
   */
  verifyWebhook(rawBody: string, headers: Headers): Promise<DeliveryEvent[] | null>;
}

export async function getEmailProvider(): Promise<EmailProvider> {
  const which = (process.env.EMAIL_PROVIDER ?? "dev").toLowerCase();
  switch (which) {
    case "resend": {
      const { ResendProvider } = await import("@/lib/email/resend");
      return new ResendProvider();
    }
    case "dev":
      return (await import("@/lib/email/dev")).devProvider;
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${which}". Use "dev" or "resend".`);
  }
}
