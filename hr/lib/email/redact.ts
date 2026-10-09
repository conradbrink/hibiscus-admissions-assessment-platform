/**
 * Removes magic links from the copy of an email that is kept in
 * `hr_email_messages`. Staff can read that table, and a live link in it
 * would let them open the applicant's form, give a referee's reference or
 * read someone's payslip. The email that is sent keeps its link; only the
 * stored copy loses it.
 */
const LINK = /https?:\/\/[^\s"'<>]+\/(?:h|r|p)\/[A-Za-z0-9_-]{40,48}/g;

export const REDACTED = "[private link removed]";

export function redactLinks(body: string): string {
  return body.replace(LINK, REDACTED);
}
