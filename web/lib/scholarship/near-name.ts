/**
 * Is this the same child under a different spelling?
 *
 * `create_application` recognises a child by contact and first name, and a
 * unique index holds one live application per child on the same key. That
 * catches "Jeremy" twice, and case and whitespace besides. It cannot catch a
 * typo, because a typo is a different string.
 *
 * The primary scholarship sheet has one: a family already on file with
 * **Letang** Aki Chilume, and a scholarship row for **Lerang** Chilume. One
 * letter apart, same parent, same surname. If they are two children, both
 * belong in the system; if they are one child, importing the second creates
 * exactly the duplicate the index exists to prevent — a second application, a
 * second set of emails, a second place in the pipeline — and nothing would
 * stop it or later notice.
 *
 * So this does not decide. It flags, so that a person looks before the letters
 * go out. A false alarm costs somebody ten seconds; a missed one costs a
 * family two applications and the school a confused phone call.
 */

/**
 * Levenshtein distance between two names, case-insensitive and trimmed.
 *
 * Plain dynamic programming over two rows. The strings here are personal
 * names — tens of characters at most, tens of rows per run — so the simple
 * version is the right one.
 */
export function nameDistance(a: string, b: string): number {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  if (x === y) return 0;
  if (!x.length) return y.length;
  if (!y.length) return x.length;

  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      current[j] = Math.min(
        previous[j] + 1, // deletion
        current[j - 1] + 1, // insertion
        previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1) // substitution
      );
    }
    previous = current;
  }
  return previous[y.length];
}

/**
 * Whether two first names are close enough to be worth a person's attention.
 *
 * One edit for a short name, two for a longer one. The length rule matters
 * both ways: "Ana" and "Ava" are one edit apart and are ordinary different
 * names, while "Tanyaradzwa" and "Tanyaradza" are also one edit apart and are
 * almost certainly the same child. Short names are common and cheap to
 * confuse, so they get the stricter threshold.
 *
 * An exact match is not "near" — that is a real match, which the database
 * handles by itself and which needs no warning.
 */
export function looksLikeSameChild(a: string, b: string): boolean {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (!x || !y) return false;

  const distance = nameDistance(x, y);
  if (distance === 0) return false;

  const shortest = Math.min(x.length, y.length);
  if (shortest <= 4) return false; // Too short to tell a typo from a name.
  return distance <= (shortest <= 7 ? 1 : 2);
}
