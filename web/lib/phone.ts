/**
 * A mobile number in two parts: the country's dialling code, chosen from a
 * list, and the number itself.
 *
 * The school messages families on WhatsApp, and WhatsApp will not accept
 * anything but E.164 — a plus, a country code, then the national number with
 * no leading zero and no spaces. A number typed as one field is guesswork:
 * "71234567" is a Botswana mobile, "0821234567" is a South African one, and
 * "812345678" could be either a Namibian mobile or a South African one typed
 * without its zero. Asking for the country first removes the guess, and this
 * module then says whether what follows it is a number that country actually
 * issues, before it is stored rather than after a message bounces.
 *
 * The rules below are for MOBILE numbers, because that is what the school
 * asks for and what WhatsApp needs. A landline that happens to be typed in
 * will be refused with a sentence saying so, which is the right answer: a
 * message to it never arrives.
 */

export type DiallingCode = {
  /** E.164 country calling code, with its plus. */
  code: string;
  /** ISO 3166-1 alpha-2, for a flag or a sort. */
  iso: string;
  name: string;
  /** What a national mobile number looks like once the trunk zero is gone. */
  pattern: RegExp;
  /** Said to a parent whose number does not match, in their words not ours. */
  hint: string;
  /** Shown in the field, so the shape is obvious before anything is typed. */
  placeholder: string;
  /** Digits per group when the number is written out, left to right. */
  groups: number[];
};

/**
 * The two campuses' own countries first, then the neighbours a family is
 * likely to be dialling from, then the two codes that turn up in an
 * international enquiry. Anything outside this list is entered as "Somewhere
 * else", which checks the shape but cannot check the network.
 */
export const DIALLING_CODES: readonly DiallingCode[] = [
  {
    code: "+267",
    iso: "BW",
    name: "Botswana",
    pattern: /^7\d{7}$/,
    hint: "A Botswana mobile is 8 digits and starts with 7 — for example 71 234 567.",
    placeholder: "71 234 567",
    groups: [2, 3, 3],
  },
  {
    code: "+27",
    iso: "ZA",
    name: "South Africa",
    pattern: /^[6-8]\d{8}$/,
    hint: "A South African mobile is 9 digits and starts with 6, 7 or 8 — for example 82 123 4567.",
    placeholder: "82 123 4567",
    groups: [2, 3, 4],
  },
  {
    code: "+263",
    iso: "ZW",
    name: "Zimbabwe",
    pattern: /^7\d{8}$/,
    hint: "A Zimbabwean mobile is 9 digits and starts with 7 — for example 77 123 4567.",
    placeholder: "77 123 4567",
    groups: [2, 3, 4],
  },
  {
    code: "+264",
    iso: "NA",
    name: "Namibia",
    pattern: /^8\d{7,8}$/,
    hint: "A Namibian mobile starts with 8 — for example 81 234 5678.",
    placeholder: "81 234 5678",
    groups: [2, 3, 4],
  },
  {
    code: "+260",
    iso: "ZM",
    name: "Zambia",
    pattern: /^[79]\d{8}$/,
    hint: "A Zambian mobile is 9 digits and starts with 7 or 9 — for example 97 123 4567.",
    placeholder: "97 123 4567",
    groups: [2, 3, 4],
  },
  {
    code: "+266",
    iso: "LS",
    name: "Lesotho",
    pattern: /^[56]\d{7}$/,
    hint: "A Lesotho mobile is 8 digits and starts with 5 or 6 — for example 58 123 456.",
    placeholder: "58 123 456",
    groups: [2, 3, 3],
  },
  {
    code: "+268",
    iso: "SZ",
    name: "Eswatini",
    pattern: /^7\d{7}$/,
    hint: "An Eswatini mobile is 8 digits and starts with 7 — for example 76 123 456.",
    placeholder: "76 123 456",
    groups: [2, 3, 3],
  },
  {
    code: "+258",
    iso: "MZ",
    name: "Mozambique",
    pattern: /^8[2-7]\d{7}$/,
    hint: "A Mozambican mobile is 9 digits and starts with 82 to 87 — for example 82 123 4567.",
    placeholder: "82 123 4567",
    groups: [2, 3, 4],
  },
  {
    code: "+254",
    iso: "KE",
    name: "Kenya",
    pattern: /^[17]\d{8}$/,
    hint: "A Kenyan mobile is 9 digits and starts with 1 or 7 — for example 71 234 5678.",
    placeholder: "71 234 5678",
    groups: [2, 3, 4],
  },
  {
    code: "+234",
    iso: "NG",
    name: "Nigeria",
    pattern: /^[789]\d{9}$/,
    hint: "A Nigerian mobile is 10 digits and starts with 7, 8 or 9 — for example 803 123 4567.",
    placeholder: "803 123 4567",
    groups: [3, 3, 4],
  },
  {
    code: "+44",
    iso: "GB",
    name: "United Kingdom",
    pattern: /^7\d{9}$/,
    hint: "A UK mobile is 10 digits and starts with 7 — for example 7700 123456.",
    placeholder: "7700 123456",
    groups: [4, 6],
  },
  {
    code: "+1",
    iso: "US",
    name: "United States or Canada",
    pattern: /^[2-9]\d{9}$/,
    hint: "A number here is 10 digits — for example 202 555 0147.",
    placeholder: "202 555 0147",
    groups: [3, 3, 4],
  },
];

/** Botswana: the school's own country, and most enquiries. */
export const DEFAULT_DIALLING_CODE = "+267";

/**
 * Somewhere we do not have a rule for. The shape is still checked — E.164
 * allows fifteen digits in total, and fewer than four is not a number
 * anywhere — but nothing is claimed about the network.
 */
const ELSEWHERE: DiallingCode = {
  // Just the plus: the country code is part of what the parent types, because
  // we have no rule to check it against.
  code: "+",
  iso: "",
  name: "Somewhere else",
  pattern: /^\d{4,14}$/,
  hint: "Enter the country code and the number, together, with no spaces — for example 351912345678.",
  placeholder: "351 912 345 678",
  groups: [],
};

export const ELSEWHERE_CODE = "other";

export function diallingCode(code: string): DiallingCode | null {
  return DIALLING_CODES.find((c) => c.code === code) ?? null;
}

/** Everything that is not a digit goes, including the trunk zero in front. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function withoutTrunkZero(digits: string): string {
  return digits.replace(/^0+/, "");
}

export type MobileCheck =
  | { ok: true; e164: string; pretty: string }
  | { ok: false; reason: string };

/**
 * The check, run in the browser as the parent types and again on the server
 * before anything is stored. One function, so the two can never disagree.
 *
 * `dialling` is a code from the list above, or `ELSEWHERE_CODE`; `national`
 * is whatever was typed in the number field, spaces, brackets, trunk zero
 * and all.
 */
export function checkMobile(dialling: string, national: string): MobileCheck {
  const raw = national.trim();
  if (!raw) return { ok: false, reason: "Enter a mobile number." };

  const country = dialling === ELSEWHERE_CODE ? ELSEWHERE : diallingCode(dialling);
  if (!country) return { ok: false, reason: "Choose the country the number is from." };

  if (/[^\d\s\-().+]/.test(raw)) {
    return { ok: false, reason: "A number is digits only, with spaces or brackets if you like." };
  }

  // A parent who pastes the whole international number into the second field
  // has done nothing wrong; drop the code they repeated rather than refusing.
  let digits = withoutTrunkZero(digitsOnly(raw));
  const bare = country.code.replace("+", "");
  if (bare && digits.startsWith(bare) && digits.length > bare.length) {
    const rest = withoutTrunkZero(digits.slice(bare.length));
    if (country.pattern.test(rest)) digits = rest;
  }

  if (!digits) return { ok: false, reason: "Enter a mobile number." };
  if (!country.pattern.test(digits)) return { ok: false, reason: country.hint };

  const e164 = `${country.code}${digits}`;
  // E.164's own limit, which WhatsApp enforces: fifteen digits after the plus.
  if (e164.replace("+", "").length > 15) {
    return { ok: false, reason: "That is too long to be a phone number." };
  }
  return { ok: true, e164, pretty: prettyMobile(e164) };
}

/** "+267 71 234 567" — the same number, spaced the way the country writes it. */
export function prettyMobile(e164: string): string {
  const country = DIALLING_CODES.find((c) => e164.startsWith(c.code) && c.pattern.test(e164.slice(c.code.length)));
  if (!country) return e164;
  const rest = e164.slice(country.code.length);
  const parts: string[] = [];
  let i = 0;
  for (const size of country.groups) {
    if (i >= rest.length) break;
    parts.push(rest.slice(i, i + size));
    i += size;
  }
  if (i < rest.length) parts.push(rest.slice(i));
  return `${country.code} ${parts.join(" ")}`.trim();
}

/**
 * A stored number, split back into the two fields, so an edit form opens
 * showing what is already there rather than making the parent type it again.
 * A number from a country we have no rule for comes back under
 * `ELSEWHERE_CODE` with its digits intact.
 */
export function splitMobile(e164: string | null | undefined): { dialling: string; national: string } {
  if (!e164) return { dialling: DEFAULT_DIALLING_CODE, national: "" };
  const trimmed = e164.trim();
  // Longest code first: +267 must win over +26 if one is ever added.
  const country = [...DIALLING_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => trimmed.startsWith(c.code) && c.pattern.test(trimmed.slice(c.code.length)));
  if (country) return { dialling: country.code, national: trimmed.slice(country.code.length) };
  return { dialling: ELSEWHERE_CODE, national: digitsOnly(trimmed) };
}

/**
 * The check the server runs on a number that arrives already in E.164 — from
 * the field above, or from anything that bypassed it.
 *
 * It is deliberately stricter than `splitMobile` + `checkMobile` would be in
 * sequence: a number carrying a dialling code we DO have a rule for must
 * satisfy that rule, so "+2673971234" (a Gaborone landline) is refused rather
 * than quietly accepted as a number from somewhere unknown. A code we have no
 * rule for is accepted on its shape alone, which is all anyone can say.
 */
export function checkStoredMobile(value: string): MobileCheck {
  const trimmed = value.trim().replace(/[\s\-().]/g, "");
  if (!trimmed) return { ok: false, reason: "Enter a mobile number." };
  if (!trimmed.startsWith("+")) {
    return { ok: false, reason: "Include the country code, starting with a plus." };
  }
  const digits = trimmed.slice(1);
  if (!/^\d+$/.test(digits)) {
    return { ok: false, reason: "A number is digits only, after the country code." };
  }

  const country = [...DIALLING_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => trimmed.startsWith(c.code));
  if (country) {
    const rest = trimmed.slice(country.code.length);
    if (!country.pattern.test(rest)) return { ok: false, reason: country.hint };
    return { ok: true, e164: trimmed, pretty: prettyMobile(trimmed) };
  }

  if (digits.length < 7 || digits.length > 15) {
    return { ok: false, reason: "That does not look like a phone number." };
  }
  return { ok: true, e164: trimmed, pretty: trimmed };
}
