/**
 * A person's name folded for comparison: case, accents, punctuation and
 * spacing aside, so "Kágo  Moeti-Smith" and "kago moeti smith" match.
 *
 * A name in a script with no Latin letters folds to nothing under that rule,
 * and two such names would then match each other, so it is compared as typed
 * instead, with only case and spacing aside.
 */
export function foldName(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  const latin = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return latin || raw.toLowerCase().replace(/\s+/g, " ");
}
