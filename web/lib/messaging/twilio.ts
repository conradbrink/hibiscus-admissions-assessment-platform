import "server-only";
import {
  buildMessageForm,
  formToParams,
  parseSendError,
  parseSendResponse,
  parseTwilioWebhook,
  verifyTwilioSignature,
} from "@/lib/messaging/twilio-payload";
import type { InboundEvent, MessagingProvider, OutboundTemplateMessage, SendResult } from "@/lib/messaging/provider";

/**
 * Twilio in front of WhatsApp, over plain fetch — no SDK, like the payment
 * gateway and Meta before it.
 *
 * Credentials are read once, at construction, so a missing one fails the
 * first send of a deploy loudly rather than every parent's message quietly.
 * The auth token is used for two unrelated things and both matter: HTTP Basic
 * on the way out, and the HMAC that proves an inbound webhook is Twilio's.
 */

const DEFAULT_API_URL = "https://api.twilio.com/2010-04-01";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; MESSAGING_PROVIDER=twilio needs it.`);
  return v;
}

export class TwilioWhatsAppProvider implements MessagingProvider {
  readonly name = "twilio";
  readonly templateIdField = "twilio_content_sid" as const;
  private readonly apiUrl: string;
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly from: string | null;
  private readonly messagingServiceSid: string | null;
  private readonly statusCallback: string | null;
  private readonly webhookUrl: string | null;

  constructor() {
    this.apiUrl = (process.env.TWILIO_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.accountSid = required("TWILIO_ACCOUNT_SID");
    this.authToken = required("TWILIO_AUTH_TOKEN");
    this.from = process.env.TWILIO_WHATSAPP_FROM ?? null;
    this.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID ?? null;
    if (!this.from && !this.messagingServiceSid) {
      throw new Error("Set TWILIO_WHATSAPP_FROM (the school's WhatsApp number) or TWILIO_MESSAGING_SERVICE_SID.");
    }
    // Where Twilio reports delivery. Same route as the inbound webhook, so
    // one URL is configured in two places in the Twilio console.
    this.statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL ?? null;
    // Twilio signs the URL it called. Behind a proxy the address the app sees
    // can differ from the one Twilio used (the scheme, most often), and then
    // every signature fails. This is the override for that case.
    this.webhookUrl = process.env.TWILIO_WEBHOOK_URL ?? null;
  }

  async sendTemplate(message: OutboundTemplateMessage): Promise<SendResult> {
    let form: URLSearchParams;
    try {
      form = buildMessageForm(message, {
        from: this.from,
        messagingServiceSid: this.messagingServiceSid,
        statusCallback: this.statusCallback,
      });
    } catch (e) {
      // A template with no content SID, or no sender: neither improves by
      // being tried again.
      return { ok: false, error: (e as Error).message, retryable: false };
    }

    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/Accounts/${this.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
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
      // 4xx is our request — an unapproved template, a number not on
      // WhatsApp, a variable count that does not match the template. 429 and
      // 5xx are Twilio's, and those are worth another go.
      const retryable = response.status >= 500 || response.status === 429;
      return { ok: false, error: `${response.status} ${parseSendError(body)}`, retryable };
    }
    const sid = parseSendResponse(body);
    if (!sid) return { ok: false, error: "send response carried no message sid", retryable: false };
    return { ok: true, providerMessageId: sid };
  }

  async verifyWebhook(rawBody: string, headers: Headers, url: string): Promise<InboundEvent[] | null> {
    const params = formToParams(rawBody);
    const signed = this.webhookUrl ?? url;
    if (!verifyTwilioSignature(signed, params, headers.get("x-twilio-signature"), this.authToken)) return null;
    return parseTwilioWebhook(params);
  }
}
