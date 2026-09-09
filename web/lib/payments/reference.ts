/**
 * What a family is told to type into their banking app, and what appears as
 * the reference on their receipt: the child's name.
 *
 * The school asked for the name alone. It is what a parent will actually type
 * and what the bursar recognises on a statement, so it is the honest choice —
 * but it is not unique. Two children called Daniel Coetzer produce the same
 * reference, and a bank statement narration is often cut to around twenty
 * characters. So the name is what is *shown*; the application's own reference
 * is still stored on every payment row (`company_ref`) and is what the
 * finance console matches on. A transfer that cannot be matched by name is
 * reconciled by hand there, as it always was.
 */
export function paymentReferenceFor(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const name = [firstName, lastName]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ");
  // Banks strip accents and punctuation, and most narration fields are upper
  // case, so the parent is shown what will actually appear on the statement.
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z\s'-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
