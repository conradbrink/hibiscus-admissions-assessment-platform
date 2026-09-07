import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHECKOUT_TTL_HOURS, type CheckoutRequest, type CheckoutResult, type PaymentProvider, type VerifyResult } from "@/lib/payments/provider";
import { PAYGATE_LIVE_API, buildInitiateFields, buildQueryFields, checksumValid, encodeForm, fieldMap, keepFields, mapTransactionStatus, parseWire, paygateDate } from "@/lib/payments/paygate-wire";

/**
 * PayGate (Payfast by Network), PayWeb 3 hosted page. We initiate a payment
 * request, send the parent through a small bridge page that posts them to
 * PayGate, and verify with query.trans when they return, when PayGate's
 * notify post arrives, and from the reconciler until the request is paid or
 * past its time limit. The return and notify posts are hints; query.trans is
 * the only source of truth.
 *
 * Hand-written fetch: the surface is three form posts.
 */

export function paygateConfig() {
  const paygateId = process.env.PAYGATE_ID;
  const key = process.env.PAYGATE_ENCRYPTION_KEY;
  if (!paygateId || !key) throw new Error("PAYGATE_ID and PAYGATE_ENCRYPTION_KEY must be set when PAYMENT_PROVIDER=paygate.");
  const apiUrl = (process.env.PAYGATE_API_URL ?? PAYGATE_LIVE_API).replace(/\/?$/, "/");
  return { paygateId, key, apiUrl };
}

async function post(url: string, body: string): Promise<Array<[string, string]>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/plain" },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PayGate responded ${res.status}`);
  return parseWire(text);
}

export const paygateProvider: PaymentProvider = {
  name: "paygate",

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const { paygateId, key, apiUrl } = paygateConfig();
    const site = new URL(request.returnUrl).origin;
    const fields = buildInitiateFields(
      {
        paygateId,
        reference: request.reference,
        amountMinor: request.amountMinor,
        currency: request.currency,
        returnUrl: request.returnUrl,
        transactionDate: paygateDate(new Date()),
        email: request.customer.email,
        notifyUrl: `${site}/api/webhooks/paygate`,
      },
      key
    );
    const reply = await post(`${apiUrl}initiate.trans`, encodeForm(fields));
    const m = fieldMap(reply);
    if (m.ERROR) throw new Error(`PayGate refused the checkout: ${m.ERROR}`);
    if (!m.PAY_REQUEST_ID) throw new Error("PayGate returned no PAY_REQUEST_ID");
    if (!checksumValid(reply, key)) throw new Error("PayGate's reply failed its checksum");
    return {
      providerRef: m.PAY_REQUEST_ID,
      // The bridge posts PAY_REQUEST_ID and its checksum to process.trans,
      // which PayGate requires as a POST rather than a link.
      redirectUrl: `/pay/gateway?ref=${encodeURIComponent(m.PAY_REQUEST_ID)}`,
      expiresAt: new Date(Date.now() + CHECKOUT_TTL_HOURS * 3_600_000),
    };
  },

  async verify(providerRef: string): Promise<VerifyResult> {
    const { paygateId, key, apiUrl } = paygateConfig();
    // query.trans needs the reference we initiated with; it is on the row.
    const admin = createAdminClient();
    const { data: row } = await admin.from("payments").select("company_ref").eq("provider_ref", providerRef).maybeSingle();
    if (!row) throw new Error("no payment carries this PayGate request id");
    const reply = await post(`${apiUrl}query.trans`, encodeForm(buildQueryFields(paygateId, providerRef, row.company_ref, key)));
    const m = fieldMap(reply);
    if (m.ERROR) throw new Error(`PayGate query failed: ${m.ERROR}`);
    if (!checksumValid(reply, key)) throw new Error("PayGate's query reply failed its checksum");
    return {
      status: mapTransactionStatus(m.TRANSACTION_STATUS),
      amountMinor: m.AMOUNT && /^\d+$/.test(m.AMOUNT) ? Number(m.AMOUNT) : null,
      currency: m.CURRENCY ?? null,
      approvalCode: m.AUTH_CODE ?? null,
      raw: keepFields(reply),
    };
  },
};
