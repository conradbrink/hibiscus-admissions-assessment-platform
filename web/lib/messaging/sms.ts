/**
 * How long an SMS is, the way a phone network counts it.
 *
 * Plain text travels in the GSM 7-bit alphabet: 160 characters in one
 * message, 153 a part once it is split. One character outside that
 * alphabet (an emoji, a curly quote, a "ș") moves the whole message to
 * UCS-2: 70 in one, 67 a part. A few GSM characters take two places, the
 * escape and the character, so `€` or `[` costs 2. Pure, so the campaign
 * form counts as the author types and the tests pin the arithmetic.
 */

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

export type SmsLength = {
  /** Characters as the network counts them (an extended GSM character counts 2). */
  units: number;
  /** "gsm" for plain text, "unicode" once anything outside the GSM alphabet is in it. */
  encoding: "gsm" | "unicode";
  /** How many messages it goes as. */
  parts: number;
  /** What fits in one message of this encoding. */
  singleLimit: number;
};

export function smsLength(text: string): SmsLength {
  let gsm = true;
  let units = 0;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXTENDED.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!gsm) {
    // UCS-2 counts UTF-16 code units: an emoji outside the basic plane is two.
    units = text.length;
    return { units, encoding: "unicode", parts: units === 0 ? 0 : units <= 70 ? 1 : Math.ceil(units / 67), singleLimit: 70 };
  }
  return { units, encoding: "gsm", parts: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153), singleLimit: 160 };
}

/** E.164, the shape every number is stored in once normalised. */
export const E164 = /^\+[1-9]\d{7,14}$/;
