/**
 * Whose fault a failed WhatsApp send was.
 *
 * The templates page counted every failure against the template, which reads
 * as "this template is broken" — and for a fortnight it was wrong about eight
 * of them. Two families had numbers that cannot receive WhatsApp, and because
 * a failure is filed against whatever template happened to be sending at the
 * time, those two parents painted eight healthy templates red. Meanwhile the
 * one template that really was refusing every send sat in the same colour as
 * the noise.
 *
 * So the question a failure has to answer is: would this have happened to
 * anybody? A template Meta has never heard of fails for every parent and is
 * the school's to fix now. A number that is not on WhatsApp fails for one
 * parent and is not a template problem at all — and the email still went.
 *
 * `template` is the default on purpose. This page exists because a template
 * failed silently for a whole day; a failure nobody has taught this function
 * about must therefore be loud rather than quiet. Only a confident match
 * demotes one to `recipient`, and being wrong that way is the expensive one.
 */

export type FailureKind =
  /** The template itself: wrong, missing, or not approved. Every parent gets nothing. */
  | "template"
  /** This one number: not on WhatsApp, or outside a window Meta will deliver in. */
  | "recipient"
  /** The whole sender: rate-limited, locked, blocked. Nothing sends at all. */
  | "account";

/**
 * Meta's numbered errors, which arrive in the text as `(#132001)`.
 *
 * Only the codes we are sure about are listed. An unlisted code falls through
 * to the phrase match and then to `template`, which is the safe direction.
 */
const RECIPIENT_CODES = new Set([
  131026, // Message undeliverable — the number cannot receive it
  131047, // Re-engagement: outside the 24-hour window
  131049, // "healthy ecosystem engagement" — Meta pacing this recipient
  470, // the older spelling of the re-engagement error
]);

const ACCOUNT_CODES = new Set([
  130429, // rate limit hit
  131031, // account locked
  131048, // spam rate limit hit
  368, // temporarily blocked for policy violations
]);

const TEMPLATE_CODES = new Set([
  132000, // number of parameters does not match
  132001, // template does not exist in the translation
  132005, // hydrated text too long
  132007, // format character policy violated
  132012, // parameter format mismatch
  132015, // template is paused
  132016, // template is disabled
]);

/** The phrases Meta sends when it does not send a code with them. */
const RECIPIENT_PHRASES = [/message undeliverable/i, /healthy ecosystem engagement/i, /re-?engagement message/i];
const ACCOUNT_PHRASES = [/rate limit/i, /account (is )?locked/i, /temporarily blocked/i];

export function classifyFailure(error: string | null | undefined): FailureKind {
  const text = error ?? "";
  const code = Number(/\(#(\d+)\)/.exec(text)?.[1]);
  if (Number.isFinite(code)) {
    if (RECIPIENT_CODES.has(code)) return "recipient";
    if (ACCOUNT_CODES.has(code)) return "account";
    if (TEMPLATE_CODES.has(code)) return "template";
  }
  if (RECIPIENT_PHRASES.some((p) => p.test(text))) return "recipient";
  if (ACCOUNT_PHRASES.some((p) => p.test(text))) return "account";
  // Anything we have not met before. Better a template flagged wrongly than a
  // broken one sending nothing in silence.
  return "template";
}

export type FailureRow = { template_key: string | null; error: string | null; to_normalised?: string | null };

export type TemplateFailures = {
  /** Failures that are this template's own fault, newest error first. */
  template: { count: number; error: string | null };
  /** Failures that belong to the parent's number, not the template. */
  recipient: { count: number; numbers: number };
};

/**
 * Group a window of failures by template, separating the two kinds.
 *
 * Rows are expected newest first, so the error kept is the most recent one —
 * the same order the page has always relied on.
 */
export function summariseFailures(rows: FailureRow[]): Map<string, TemplateFailures> {
  const byTemplate = new Map<string, TemplateFailures & { _numbers: Set<string> }>();
  for (const row of rows) {
    // An inbound reply carries no template key and cannot fail to send.
    if (!row.template_key) continue;
    let entry = byTemplate.get(row.template_key);
    if (!entry) {
      entry = { template: { count: 0, error: null }, recipient: { count: 0, numbers: 0 }, _numbers: new Set() };
      byTemplate.set(row.template_key, entry);
    }
    const kind = classifyFailure(row.error);
    if (kind === "recipient") {
      entry.recipient.count += 1;
      if (row.to_normalised) entry._numbers.add(row.to_normalised);
    } else {
      // An account-wide failure still stops this template sending, so the row
      // says so; the banner above the list explains that it is not the
      // template's doing.
      entry.template.count += 1;
      entry.template.error ??= row.error;
    }
  }
  const out = new Map<string, TemplateFailures>();
  for (const [key, entry] of byTemplate) {
    out.set(key, { template: entry.template, recipient: { count: entry.recipient.count, numbers: entry._numbers.size } });
  }
  return out;
}

/** Whether anything in the window says the sender itself is blocked. */
export function accountIsBlocked(rows: FailureRow[]): { blocked: boolean; error: string | null } {
  const hit = rows.find((r) => classifyFailure(r.error) === "account");
  return { blocked: Boolean(hit), error: hit?.error ?? null };
}
