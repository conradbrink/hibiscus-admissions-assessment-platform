/**
 * Suggestion lists for registration fields that usually have one of a known
 * set of answers but cannot be closed: the language spoken at home and the
 * medical aid. The parent types and picks; a known answer is saved in the
 * list's spelling, an unknown one is kept as typed so nobody is stuck.
 * Countries and nationalities are the strict lists in `lib/countries.ts`.
 */

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Languages of Botswana and its neighbours first, then the rest A to Z. */
export const LANGUAGES: readonly string[] = [
  "Setswana",
  "English",
  "Afrikaans",
  "Ikalanga",
  "Shona",
  "isiNdebele",
  "isiZulu",
  "isiXhosa",
  "Sesotho",
  "Sepedi",
  "Xitsonga",
  "Tshivenda",
  "siSwati",
  "Shekgalagari",
  "Otjiherero",
  "Sebirwa",
  "Setswapong",
  "Thimbukushu",
  "Sesubiya",
  "Shiyeyi",
  "Naro",
  "Oshiwambo",
  "Chichewa",
  "Bemba",
  "Portuguese",
  "French",
  ...[
    "Amharic", "Arabic", "Bengali", "Cantonese", "Dutch", "German", "Greek", "Gujarati", "Hausa", "Hebrew", "Hindi", "Igbo",
    "Italian", "Japanese", "Kinyarwanda", "Korean", "Lingala", "Luganda", "Malay", "Malayalam", "Mandarin", "Marathi", "Nepali",
    "Oromo", "Persian (Farsi)", "Polish", "Punjabi", "Romanian", "Russian", "Serbian", "Sinhala", "Somali", "Spanish", "Swahili",
    "Tagalog (Filipino)", "Tamil", "Telugu", "Thai", "Tigrinya", "Turkish", "Ukrainian", "Urdu", "Vietnamese", "Wolof", "Yoruba",
  ].sort((a, b) => a.localeCompare(b, "en")),
];

/** Medical aids seen in Botswana and South Africa, and the international insurers expatriate families use. */
export const MEDICAL_AIDS: readonly string[] = [
  "BOMaid",
  "Pula Medical Aid Fund",
  "BPOMAS (Botswana Public Officers Medical Aid Scheme)",
  "Botsogo Health Plan",
  "Itekanele",
  "Discovery Health",
  "Bonitas",
  "Momentum Health",
  "Medihelp",
  "Fedhealth",
  "Bestmed",
  "GEMS (Government Employees Medical Scheme)",
  "Polmed",
  "Profmed",
  "Sizwe Hosmed",
  "Medshield",
  "Aetna International",
  "Allianz Care",
  "Bupa Global",
  "Cigna Global",
  "MSH International",
];

/** The list's spelling for a known answer; the trimmed text otherwise; null when blank. */
export function canonicalFromList(list: readonly string[], raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const q = fold(trimmed);
  return list.find((o) => fold(o) === q) ?? list.find((o) => fold(o).split(" (")[0] === q) ?? trimmed;
}
