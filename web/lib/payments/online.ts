/**
 * Which currencies can be paid online, and which have to be paid by transfer.
 *
 * The school's gateway is PayGate, arranged in Botswana and settling in Pula.
 * Potchefstroom is in South Africa and charges in Rand, and no South African
 * gateway has been arranged yet. Sending a Rand payment to the Botswana
 * gateway is not a small mistake: at best it is refused at the card page,
 * which reads to a family as "the school's payment page is broken", and at
 * worst it takes the money in the wrong currency.
 *
 * So a currency the configured gateway cannot take is not offered at all.
 * Those families are asked for a bank transfer, which is how the school has
 * always taken Potch fees anyway, and the offer letter already carries the
 * account details.
 *
 * Pure, so vitest covers it and both the page and the action can read it.
 */

export type ProviderName = "dev" | "dpo" | "paygate";
export type Currency = "BWP" | "ZAR";

/**
 * What each gateway is set up to take.
 *
 * `dev` charges nothing and can never report a payment as made, so it takes
 * both: a developer testing the Potch path should see the same screens a
 * parent will once a South African gateway exists.
 *
 * `dpo` is listed as Pula only. DPO Pay does operate in South Africa, but the
 * school has no South African account with them, and a list here is a claim
 * that money will arrive. Widen it when an account exists and has been tested.
 */
export const GATEWAY_CURRENCIES: Record<ProviderName, readonly Currency[]> = {
  paygate: ["BWP"],
  dpo: ["BWP"],
  dev: ["BWP", "ZAR"],
};

/** Whether this gateway can take this currency at all. */
export function canPayOnline(provider: ProviderName, currency: string): boolean {
  return (GATEWAY_CURRENCIES[provider] as readonly string[]).includes(currency);
}

/**
 * What to tell a family who cannot pay online, and staff who wonder why the
 * button is missing. One sentence, no apology, no mention of the gateway's
 * name — a parent does not care which company the school banks with.
 */
export function transferOnlyReason(currency: string): string {
  return `Fees in ${currency} are paid by bank transfer. Online card payment is not available for this campus yet.`;
}
