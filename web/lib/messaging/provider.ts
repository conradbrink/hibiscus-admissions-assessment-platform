import "server-only";

/**
 * The seam between this system and whoever delivers its WhatsApp messages.
 *
 * Nothing outside lib/messaging imports a vendor SDK or knows a provider's
 * name. The production adapter is chosen by MESSAGING_PROVIDER — `zavu` for
 * Zavu, `meta` for WhatsApp's own Cloud API, `twilio` for Twilio; unset means
 * `dev`, which delivers nothing and records everything, so a misconfigured
 * deploy cannot message real parents.
 *
 * Templates are how the school speaks first. WhatsApp allows free text
 * solely inside the 24-hour window a parent opens by writing to us, so
 * nothing scheduled could ever use it — every outbound moment is a template,
 * named and approved.
 *
 * `sendText` is the one exception, and only for answering a parent who has
 * just written: the window is open by definition, and it needs no approval,
 * which matters when the thing being said is "you are writing to the wrong
 * number". The wording still is not in code — it is a setting the school
 * edits — so what this seam carries is the text, not the decision to send it.
 */

export type OutboundTemplateMessage = {
  /** E.164, with the leading plus. */
  to: string;
  templateName: string;
  language: string;
  /**
   * The provider's own handle for the template where its name is not enough:
   * Twilio addresses a content template by SID (`HX…`), Meta by name. Null
   * for a provider that needs only the name.
   */
  providerTemplateId?: string | null;
  /** Values for {{1}}…{{n}}, in order, already sanitised. */
  bodyParams: string[];
  /** The dynamic suffix for the template's URL button, when it has one. */
  buttonUrlSuffix?: string | null;
  idempotencyKey: string;
};

/**
 * Free text, inside the 24-hour window a parent's own message opens.
 * No template, no parameters: what is in `text` is what arrives.
 */
export type OutboundTextMessage = {
  /** E.164, with the leading plus. */
  to: string;
  text: string;
  idempotencyKey: string;
};

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string; retryable: boolean };

export type InboundEvent =
  | { kind: "status"; providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; error?: string | null; occurredAt: Date }
  | { kind: "text"; providerMessageId: string; from: string; text: string; occurredAt: Date };

/**
 * Which column of `message_templates` carries this provider's handle for a
 * template. A template with nothing in it cannot be sent, and the send path
 * skips it with a reason rather than failing at the provider.
 */
export type TemplateIdField = "meta_template_name" | "twilio_content_sid" | "zavu_template_id";

export interface MessagingProvider {
  readonly name: string;
  readonly templateIdField: TemplateIdField;
  sendTemplate(message: OutboundTemplateMessage): Promise<SendResult>;
  /**
   * Free text to a parent who has just written in. Only ever called from the
   * inbound path, so the 24-hour window is open; a provider that refuses it
   * fails the send like any other, and the auto-reply is simply not made.
   */
  sendText(message: OutboundTextMessage): Promise<SendResult>;
  /**
   * Verifies a webhook and returns the events it carries, or null when the
   * signature does not check out. A null must be answered with a 401.
   *
   * `url` is the absolute address the request arrived at. Meta signs only the
   * body and ignores it; Twilio signs the URL together with every form field,
   * so a URL that differs by so much as its scheme verifies nothing.
   */
  verifyWebhook(rawBody: string, headers: Headers, url: string): Promise<InboundEvent[] | null>;
}

export async function getMessagingProvider(): Promise<MessagingProvider> {
  const which = (process.env.MESSAGING_PROVIDER ?? "dev").toLowerCase();
  switch (which) {
    case "meta": {
      const { MetaWhatsAppProvider } = await import("@/lib/messaging/meta");
      return new MetaWhatsAppProvider();
    }
    case "twilio": {
      const { TwilioWhatsAppProvider } = await import("@/lib/messaging/twilio");
      return new TwilioWhatsAppProvider();
    }
    case "zavu": {
      const { ZavuProvider } = await import("@/lib/messaging/zavu");
      return new ZavuProvider();
    }
    case "dev":
      return (await import("@/lib/messaging/dev")).devMessagingProvider;
    default:
      throw new Error(`Unknown MESSAGING_PROVIDER "${which}". Use "dev", "meta", "twilio" or "zavu".`);
  }
}
