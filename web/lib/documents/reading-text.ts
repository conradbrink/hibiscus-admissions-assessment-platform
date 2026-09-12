/**
 * Making a value read off a document fit to put in a sentence.
 *
 * Everything an extractor returns started life as pixels a parent uploaded.
 * The model is asked to transcribe what is printed, and it does — including,
 * if somebody prints it there on purpose, a line break, a run of spaces, a
 * right-to-left override, or two hundred characters of instructions aimed at
 * whoever reads the task it lands in.
 *
 * The reading is only ever a proposal — nothing here writes a registration
 * field, and a person always saves the form — so the risk is not that a
 * forged value is believed. It is that a forged value does not *look* like
 * one value. `mismatchText` writes one line per disagreement:
 *
 *     Place of birth: the birth certificate shows Gaborone; the form says Maun
 *
 * A newline inside the transcribed value forges a second line, and a second
 * line in a staff task or a parent's email reads as something the school
 * wrote. A bidi override does the same to a single line: the characters
 * stored and the characters displayed stop being the same text, which is
 * exactly the trick used to make one thing look like another.
 *
 * So: one line, one space between words, no invisible characters, and a
 * length. Applied where a reading enters the system and again where flags
 * are read back, because rows written before this existed are still in
 * `registrations.mismatch_flags` and still get rendered.
 *
 * Not a substitute for escaping. HTML email bodies escape their variables
 * and React escapes what it renders; this is about the *shape* of the text,
 * not about markup. Both, always.
 *
 * Pure. Unit tested.
 */

/** The longest a transcribed field may be, matching the extraction schemas. */
export const MAX_FIELD_CHARS = 200;

/**
 * C0 and C1 controls (newline, tab, escape), the soft hyphen, the Unicode
 * line and paragraph separators, and — the ones nobody thinks of — the
 * bidirectional embedding, override and isolate characters, the zero-width
 * joiners and the byte-order mark. Each either breaks the line or makes the
 * text lie about itself.
 */
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/**
 * One line of plain text: no control or direction-changing characters, no
 * runs of whitespace, trimmed, and no longer than a field may be.
 */
export function oneLine(value: string): string {
  return value.replace(INVISIBLE, " ").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD_CHARS);
}

/**
 * `oneLine` for a value that may not be a string at all — what comes back
 * out of a `json` column. Anything that is not a non-empty string is null,
 * which is what every reader of a reading already expects.
 */
export function oneLineOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = oneLine(value);
  return cleaned || null;
}

/**
 * A whole reading, cleaned. Keys are left exactly as they are — the schema
 * decides those — and non-string values (the confidence, a null) pass
 * through untouched.
 */
export function sanitiseReading<T extends Record<string, unknown>>(fields: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = typeof value === "string" ? oneLineOrNull(value) : value;
  }
  return out as T;
}
