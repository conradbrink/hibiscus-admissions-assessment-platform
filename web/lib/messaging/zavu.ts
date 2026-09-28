import "server-only";
import {
  buildSendBody,
  buildSmsBody,
  buildTextBody,
  parseSendError,
  parseSendResponse,
  parseZavuWebhook,
  verifyZavuSignature,
} from "@/lib/messaging/zavu-payload";
import type { InboundEvent, MessagingProvider, OutboundSmsMessage, OutboundTemplateMessage, OutboundTextMessage, SendResult } from "@/lib/messaging/provider";

/**
 * Zavu, over plain fetch — no SDK, like the payment gateway and Meta before it.
 *
 * Credentials are read once, at construction, so a missing one fails the
 * first send of a deploy loudly rather than every parent's message quietly.
 * The API key and the webhook secret are different values from different
 * places: the key is minted in Dashboard → API keys, the secret is returned
 * once when Zavu registers a sender's webhook. Rotating either breaks only
 * its own half.
 *
 * A key beginning `zv_test_` sends against Zavu's WhatsApp sandbox instead of
 * a real number, which is how this is proved before a parent is involved.
 */

const DEFAULT_API_URL = "https://api.zavu.dev";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; MESSAGING_PROVIDER=zavu needs it.`);
  return v;
}

export class ZavuProvider implements MessagingProvider {
  readonly name = "zavu";
  readonly templateIdField = "zavu_template_id" as const;
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly senderId: string | null;
  private readonly webhookSecret: string;

  constructor() {
    this.apiUrl = (process.env.ZAVU_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
    this.apiKey = required("ZAVU_API_KEY");
    // Optional: an account with one sender does not need to name it, and a
    // key can be scoped to one. Named here when the account has several.
    this.senderId = process.env.ZAVU_SENDER_ID ?? null;
    this.webhookSecret = required("ZAVU_WEBHOOK_SECRET");
  }

  async sendTemplate(message: OutboundTemplateMessage): Promise<SendResult> {
    let body: Record<string, unknown>;
    try {
      body = buildSendBody(message);
    } catch (e) {
      // A template with no Zavu id: not a thing another attempt fixes.
      return { ok: false, error: (e as Error).message, retryable: false };
    }
    return this.post(body);
  }

  /** Free text, for answering a parent inside their own 24-hour window. */
  async sendText(message: OutboundTextMessage): Promise<SendResult> {
    let body: Record<string, unknown>;
    try {
      body = buildTextBody(message);
    } catch (e) {
      return { ok: false, error: (e as Error).message, retryable: false };
    }
    return this.post(body);
  }

  /**
   * A one-way SMS, as the sender named for it (the school's SMS sender is a
   * different Zavu sender from its WhatsApp one) or else the usual one.
   */
  async sendSms(message: OutboundSmsMessage): Promise<SendResult> {
    let body: Record<string, unknown>;
    try {
      body = buildSmsBody(message);
    } catch (e) {
      return { ok: false, error: (e as Error).message, retryable: false };
    }
    return this.post(body, message.senderId || this.senderId);
  }

  private async post(body: Record<string, unknown>, senderId: string | null = this.senderId): Promise<SendResult> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/v1/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(senderId ? { "Zavu-Sender": senderId } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { ok: false, error: `network: ${(e as Error).message}`, retryable: true };
    }

    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      // 4xx is our request — an unapproved template, a number not on
      // WhatsApp, a variable count that does not match. 429 and 5xx are
      // Zavu's, and those are worth another go.
      const retryable = response.status >= 500 || response.status === 429;
      return { ok: false, error: `${response.status} ${parseSendError(parsed)}`, retryable };
    }
    const id = parseSendResponse(parsed);
    if (!id) return { ok: false, error: "send response carried no message id", retryable: false };
    return { ok: true, providerMessageId: id };
  }

  // `url` is unused: Zavu signs the body, and the timestamp with it.
  async verifyWebhook(rawBody: string, headers: Headers): Promise<InboundEvent[] | null> {
    const check = verifyZavuSignature(this.webhookSecret, rawBody, headers.get("x-zavu-signature"));
    if (!check.ok) {
      // The reason matters when a webhook is first wired up — a stale
      // delivery and a wrong secret look identical from the outside.
      console.warn(`[whatsapp:zavu] refused a webhook: ${check.reason}`);
      return null;
    }
    return parseZavuWebhook(rawBody);
  }
}
