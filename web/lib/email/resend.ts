import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DeliveryEvent, EmailProvider, OutboundEmail, SendResult } from "@/lib/email/provider";

/**
 * Resend, over its REST API directly — the SDK adds nothing we use, and
 * keeping to `fetch` means the provider surface is this one file.
 *
 * Requires RESEND_API_KEY and EMAIL_FROM. Webhooks are signed by Svix;
 * RESEND_WEBHOOK_SECRET is the `whsec_…` value from the Resend dashboard.
 */
export class ResendProvider implements EmailProvider {
  readonly name = "resend";
  private readonly apiKey: string;
  private readonly from: string;

  constructor() {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) {
      throw new Error("EMAIL_PROVIDER=resend needs RESEND_API_KEY and EMAIL_FROM.");
    }
    this.apiKey = key;
    this.from = from;
  }

  async send(email: OutboundEmail): Promise<SendResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: this.from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content).toString("base64"),
          content_type: a.contentType,
        })),
      }),
    });

    // Read as text first: an error page is HTML, and .json() on it throws a
    // parse error that hides the real status.
    const body = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `Resend ${res.status}: ${body.slice(0, 300)}`,
        // 4xx is our mistake (bad address, bad key) and will not fix itself.
        retryable: res.status >= 500 || res.status === 429,
      };
    }
    try {
      const parsed = JSON.parse(body) as { id?: string };
      if (!parsed.id) return { ok: false, error: "Resend returned no id", retryable: true };
      return { ok: true, providerMessageId: parsed.id };
    } catch {
      return { ok: false, error: "Resend returned unparseable JSON", retryable: true };
    }
  }

  async verifyWebhook(rawBody: string, headers: Headers): Promise<DeliveryEvent[] | null> {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) return null;
    const id = headers.get("svix-id");
    const timestamp = headers.get("svix-timestamp");
    const signatures = headers.get("svix-signature");
    if (!id || !timestamp || !signatures) return null;

    // Replay window: five minutes either side.
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return null;

    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
    const presented = signatures
      .split(" ")
      .map((s) => s.split(",")[1])
      .filter(Boolean)
      .map((s) => Buffer.from(s, "base64"));
    const valid = presented.some((p) => p.length === expected.length && timingSafeEqual(p, expected));
    if (!valid) return null;

    let payload: { type?: string; created_at?: string; data?: { email_id?: string } };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return null;
    }
    const emailId = payload.data?.email_id;
    if (!emailId || !payload.type) return [];

    const map: Record<string, DeliveryEvent["kind"]> = {
      "email.delivered": "delivered",
      "email.opened": "opened",
      "email.clicked": "clicked",
      "email.bounced": "bounced",
      "email.complained": "complained",
    };
    const kind = map[payload.type];
    if (!kind) return [];
    return [
      {
        providerMessageId: emailId,
        kind,
        occurredAt: payload.created_at ? new Date(payload.created_at) : new Date(),
      },
    ];
  }
}
