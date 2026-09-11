import { placeholderCount } from "@/lib/messaging/meta-payload";

/**
 * What makes a template mapping unsaveable.
 *
 * This lives away from the editor because both sides run it: the editor
 * calls it on every keystroke so the Save button is honest, and the server
 * action calls it again before writing, since a form post is not obliged to
 * have come from our form.
 *
 * It used to be exported from the editor itself, which is a `"use client"`
 * module — and every export of one of those is a client reference, so the
 * server action's call reached a stub and threw "Attempted to call
 * templateProblems() from the server". The browser-side check passed, the
 * page looked fine, and the error appeared only when somebody pressed Save.
 * A pure function shared across the boundary belongs in neither half.
 */

/** Twilio's Content Template SIDs are `HX` and thirty-two hex characters. */
export const TWILIO_CONTENT_SID = /^HX[0-9a-fA-F]{32}$/;

export function templateProblems(input: {
  parameters: string[];
  bodyPreview: string;
  allowed: string[];
  metaName: string;
  twilioContentSid?: string;
  zavuTemplateId?: string;
  active: boolean;
}): string[] {
  const problems: string[] = [];
  const unknown = input.parameters.filter((p) => !input.allowed.includes(p));
  if (unknown.length) problems.push(`Not an allowed variable for this email: ${unknown.join(", ")}`);
  const links = input.parameters.filter((p) => p.endsWith("_link"));
  if (links.length) problems.push(`Links go on the button, not in the text: ${links.join(", ")}`);
  const n = placeholderCount(input.bodyPreview);
  if (n !== input.parameters.length) problems.push(`The wording has ${n} placeholder(s) but ${input.parameters.length} variable(s) are listed`);
  const sid = (input.twilioContentSid ?? "").trim();
  if (input.metaName && !/^[a-z0-9_]+$/.test(input.metaName)) {
    problems.push("A Meta template name is lower-case letters, digits and underscores");
  }
  if (sid && !TWILIO_CONTENT_SID.test(sid)) {
    problems.push("A Twilio content SID starts HX and has thirty-two more characters");
  }
  // Either identifier will do: whichever provider is delivering reads its
  // own, and a school moving between them keeps both for a while.
  if (input.active && !input.metaName && !sid && !(input.zavuTemplateId ?? "").trim()) {
    problems.push("An active template needs an id from whichever provider is sending: Zavu, Twilio or Meta");
  }
  return problems;
}
