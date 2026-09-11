/**
 * Turning a number somebody typed into a link a phone can open.
 *
 * The numbers are stored exactly as the school writes them — `+267 392 4299`,
 * spaces and all — because that is what is painted on the building and what a
 * parent should read. Neither `tel:` nor `wa.me` wants it that way, so the
 * conversion happens here rather than in three components with three slightly
 * different regexes.
 */

/** Digits only, with the leading + kept for tel: and dropped for wa.me. */
function digits(raw: string): string {
  return raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
}

/**
 * `tel:` preserves the leading +, which is what makes an international number
 * dial correctly from a phone roaming outside Botswana.
 */
export function telHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = digits(raw.trim());
  const bare = d.startsWith("+") ? d.slice(1) : d;
  // Shorter than this is a typo, not a number, and a dead link is worse than
  // no link: the component simply does not offer that way of reaching us.
  return bare.length >= 7 ? `tel:${d}` : null;
}

/**
 * wa.me takes the full international number with no plus and no separators.
 * A number stored without a country code cannot be linked — WhatsApp would
 * resolve it against whatever country the reader's own number is in — so it
 * is shown as text instead.
 */
export function whatsappHref(raw: string | null | undefined, opts: { text?: string } = {}): string | null {
  if (!raw) return null;
  const d = digits(raw.trim());
  if (!d.startsWith("+")) return null;
  const bare = d.slice(1);
  if (bare.length < 8) return null;
  const query = opts.text ? `?text=${encodeURIComponent(opts.text)}` : "";
  return `https://wa.me/${bare}${query}`;
}

/** The street address alone: the first line of the blob that prints on letters. */
export function streetLine(address: string | null | undefined): string | null {
  if (!address) return null;
  const first = address.split(/\r?\n/)[0]?.trim();
  return first || null;
}
