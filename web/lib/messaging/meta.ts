import "server-only";
import { buildTemplatePayload, parseSendError, parseSendResponse, parseWebhook, verifySignature } from "@/lib/messaging/meta-payload";
import type { InboundEvent, MessagingProvider, OutboundTemplateMessage, SendResult } from "@/lib/messaging/provider";

/**
 * Meta's WhatsApp Cloud API, over plain fetch. One endpoint to send, one
 * signature to verify. Credentials come from the environment and are read
 * once, at construction, so a missing one fails the deploy's first send
 * loudly rather than every parent's message quietly.
 */

const DEFAULT_API_URL = "https://graph.facebook.com/v21.0";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; MESSAGING_PROVIDER=meta needs it.`);
  return v;
}

export class MetaWhatsAppProvider implements MessagingProvider {
  readonly name = "meta";
  private readonly apiUrl: string;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly appSecret: string;

  constructor() {
    this.apiUrl = (process.env.WHATSAPP_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.phoneNumberId = required("WHATSAPP_PHONE_NUMBER_ID");
    this.accessToken = required("WHATSAPP_ACCESS_TOKEN");
    this.appSecret = required("WHATSAPP_APP_SECRET");
  }

  async sendTemplate(message: OutboundTemplateMessage): Promise<SendResult> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/${this.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildTemplatePayload(message)),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { ok: false, error: `network: ${(e as Error).message}`, retryable: true };
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!response.ok) {
      // 4xx is our request (a wrong template name, an unapproved template, a
      // number that is not on WhatsApp): retrying will not help. 5xx and 429 will.
      const retryable = response.status >= 500 || response.status === 429;
      return { ok: false, error: `${response.status} ${parseSendError(body)}`, retryable };
    }
    const id = parseSendResponse(body);
    if (!id) return { ok: false, error: "send response carried no message id", retryable: false };
    return { ok: true, providerMessageId: id };
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<InboundEvent[] | null> {
    if (!verifySignature(rawBody, headers.get("x-hub-signature-256"), this.appSecret)) return null;
    return parseWebhook(rawBody);
  }
}
