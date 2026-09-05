import "server-only";
import { CHECKOUT_TTL_HOURS, type CheckoutRequest, type CheckoutResult, type PaymentProvider, type VerifyResult } from "@/lib/payments/provider";
import { buildCreateTokenXml, buildVerifyTokenXml, dpoAmountToMinor, dpoServiceDate, mapVerifyResult, parseDpoResponse } from "@/lib/payments/dpo-xml";

/**
 * DPO Pay (dpogroup.com), API v6. Hosted payment page: we create a token,
 * send the parent to DPO's page, and verify the token server-side when they
 * come back — and again from the reconciler until it is paid or expired.
 * DPO has no signed webhook, so the return URL's query string is a hint at
 * most; verifyToken is the only source of truth.
 *
 * Hand-written fetch rather than an SDK: the surface is two XML documents,
 * and keeping it here means the provider is this one file.
 */

const LIVE_API = "https://secure.3gdirectpay.com/API/v6/";

function config() {
  const companyToken = process.env.DPO_COMPANY_TOKEN;
  const serviceType = process.env.DPO_SERVICE_TYPE;
  if (!companyToken || !serviceType) throw new Error("DPO_COMPANY_TOKEN and DPO_SERVICE_TYPE must be set when PAYMENT_PROVIDER=dpo.");
  const apiUrl = process.env.DPO_API_URL ?? LIVE_API;
  return { companyToken, serviceType, apiUrl };
}

/** The pay page lives beside the API on the same host: /API/v6/ → /payv2.php */
export function payPageUrl(apiUrl: string, transToken: string): string {
  const base = apiUrl.replace(/\/API\/v6\/?$/i, "");
  return `${base}/payv2.php?ID=${encodeURIComponent(transToken)}`;
}

async function post(apiUrl: string, xml: string): Promise<string> {
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "content-type": "application/xml", accept: "application/xml" },
    body: xml,
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`DPO responded ${res.status}`);
  return text;
}

export const dpoProvider: PaymentProvider = {
  name: "dpo",

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const { companyToken, serviceType, apiUrl } = config();
    const xml = buildCreateTokenXml({
      companyToken,
      serviceType,
      amountMinor: request.amountMinor,
      currency: request.currency,
      companyRef: request.reference,
      description: request.description,
      redirectUrl: request.returnUrl,
      backUrl: request.backUrl,
      ptlHours: CHECKOUT_TTL_HOURS,
      customer: request.customer,
      serviceDate: dpoServiceDate(new Date()),
    });
    const parsed = parseDpoResponse(await post(apiUrl, xml));
    if (parsed.Result !== "000" || !parsed.TransToken) {
      throw new Error(`DPO refused the checkout: ${parsed.Result ?? "no result"} ${parsed.ResultExplanation ?? ""}`.trim());
    }
    return {
      providerRef: parsed.TransToken,
      redirectUrl: payPageUrl(apiUrl, parsed.TransToken),
      expiresAt: new Date(Date.now() + CHECKOUT_TTL_HOURS * 3_600_000),
    };
  },

  async verify(providerRef: string): Promise<VerifyResult> {
    const { companyToken, apiUrl } = config();
    const parsed = parseDpoResponse(await post(apiUrl, buildVerifyTokenXml(companyToken, providerRef)));
    return {
      status: mapVerifyResult(parsed.Result),
      amountMinor: dpoAmountToMinor(parsed.TransactionAmount),
      currency: parsed.TransactionCurrency ?? null,
      approvalCode: parsed.TransactionApproval ?? null,
      raw: { ...parsed },
    };
  },
};
