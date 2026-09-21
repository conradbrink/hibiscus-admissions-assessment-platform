/**
 * The answer a parent gets when they write to the line that sends the
 * updates.
 *
 * They write to it because it looks like a chat: a message arrives from a
 * number, and the obvious thing to do with a number that has just written to
 * you is write back. The reply does reach the school — it becomes a task for
 * the campus team — but the parent hears nothing and goes on believing they
 * have asked a question. This is the sentence that tells them, at the moment
 * they get it wrong, which is the only moment they are certain to read it.
 *
 * Free text rather than a template, which is allowed because the parent's own
 * message opens WhatsApp's 24-hour window; it needs no approval from Meta,
 * which matters when the thing being said is "you are writing to the wrong
 * number". The wording is a setting the school edits, not a string in here.
 *
 * Pure: the decision and the text, with no database and no provider, so both
 * can be read off a test rather than a parent's phone.
 */

/** How long before the same parent is told again. A day: they may write twice in a morning. */
export const AUTO_REPLY_COOLDOWN_HOURS = 24;

export type AutoReplyDecision =
  | { send: true; text: string }
  | { send: false; reason: string };

export type AutoReplyInputs = {
  enabled: boolean;
  /** The wording, from settings. `{{whatsapp}}` and `{{phone}}` are filled in. */
  template: string;
  /** The campus's manned WhatsApp number, or the school's default. */
  whatsapp: string | null;
  /** The campus's phone number, if it has one. */
  phone: string | null;
  /** True when the message was STOP or START: consent is answered by acting, not talking. */
  isConsentCommand: boolean;
  /** When this parent was last auto-replied to, if ever. */
  lastRepliedAt: Date | null;
  now: Date;
};

/**
 * Whether to answer, and with what.
 *
 * Every "no" names itself, because an auto-reply that silently does not
 * happen is indistinguishable from one that was never built.
 */
export function autoReplyFor(input: AutoReplyInputs): AutoReplyDecision {
  if (!input.enabled) return { send: false, reason: "the automatic reply is switched off" };
  if (input.isConsentCommand) return { send: false, reason: "STOP and START are answered by acting on them" };
  if (!input.whatsapp) return { send: false, reason: "no manned number is set for this campus" };

  if (input.lastRepliedAt) {
    const hours = (input.now.getTime() - input.lastRepliedAt.getTime()) / 3_600_000;
    if (hours < AUTO_REPLY_COOLDOWN_HOURS) {
      return { send: false, reason: `already told them ${Math.floor(hours)}h ago` };
    }
  }

  const text = fillIn(input.template, input.whatsapp, input.phone);
  if (!text.trim()) return { send: false, reason: "the wording is empty" };
  return { send: true, text };
}

/**
 * The two numbers, into the wording.
 *
 * A school that has not set a phone number should not send a sentence with a
 * hole in it, so the clause that carries it is dropped whole — which is why
 * the phone sits inside `{{#phone}}…{{/phone}}` rather than standing alone.
 */
export function fillIn(template: string, whatsapp: string, phone: string | null): string {
  const withPhone = phone
    ? template.replace(/\{\{#phone\}\}([\s\S]*?)\{\{\/phone\}\}/g, (_m, inner: string) => inner)
    : template.replace(/\{\{#phone\}\}[\s\S]*?\{\{\/phone\}\}/g, "");
  return withPhone
    .replace(/\{\{whatsapp\}\}/g, whatsapp)
    .replace(/\{\{phone\}\}/g, phone ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
