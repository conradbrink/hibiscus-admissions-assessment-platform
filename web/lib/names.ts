/**
 * A name folded for comparison: case, accents, punctuation and spacing
 * aside, so "Kágo  Moeti-Smith" and "kago moeti smith" match.
 *
 * Letters of every script are kept. Folding to a-z only, as the document
 * comparison does, turns any name with no Latin letters into nothing, and two
 * such names then match each other. NFKD makes a precomposed and a decomposed
 * spelling of the same letter equal before the accents come off.
 */
export function foldName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
