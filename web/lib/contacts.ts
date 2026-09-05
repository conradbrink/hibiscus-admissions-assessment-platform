/**
 * Normalising what a parent types, so that the same family is recognised the
 * second time.
 */

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Best-effort E.164 for the two countries the school operates in.
 *
 *   71 234 567        → +26771234567   (Botswana: 8 digits, mobiles start 7)
 *   +267 71 234 567   → +26771234567
 *   0026771234567     → +26771234567
 *   082 123 4567      → +27821234567   (South Africa: 0 + 9 digits)
 *   +27 82 123 4567   → +27821234567
 *
 * Returns null when the shape is not recognised. The raw value is always
 * kept alongside, so nothing is lost — a number we could not normalise is
 * still a number a member of staff can dial.
 */
export function normaliseMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s\-().]/g, "");
  if (!s) return null;
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (s.startsWith("+")) {
    const digits = s.slice(1);
    if (!/^\d{8,15}$/.test(digits)) return null;
    return "+" + digits;
  }
  if (/^\d{8}$/.test(s)) return "+267" + s;
  if (/^0\d{9}$/.test(s)) return "+27" + s.slice(1);
  if (/^267\d{8}$/.test(s)) return "+" + s;
  if (/^27\d{9}$/.test(s)) return "+" + s;
  return null;
}

/** "Sarah" from " sarah ", "SMITH" from "smith" is not our business — trim only. */
export function tidyName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
