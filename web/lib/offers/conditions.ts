/**
 * The conditions a school attaches to an offer. Staff tick the ones that
 * apply (and add a detail where one is needed); the parent reads them as
 * numbered sentences in the letter. The wording lives here, once, in plain
 * English, and the letter stores the finished text, so a later change to
 * this list never alters a letter already sent. Pure; unit tested.
 */

export type ConditionDetail = "grade" | "text" | null;

export type OfferCondition = {
  key: string;
  /** What staff see on the form. */
  label: string;
  /** What staff see under the label. */
  hint?: string;
  /** Whether the condition needs a detail, and what kind. */
  detail: ConditionDetail;
  detailLabel?: string;
  /** The parent-facing sentence. {child}, {applied} and {detail} are filled in. */
  text: string;
};

export const OFFER_CONDITIONS: readonly OfferCondition[] = [
  {
    key: "facilitator",
    label: "Learning facilitator required",
    hint: "The family arranges and pays for a facilitator in class.",
    detail: null,
    text: "{child} will need the support of a learning facilitator in class. The family arranges and pays for the facilitator, in consultation with the school, for as long as the school considers it necessary.",
  },
  {
    key: "lower_stage",
    label: "Place offered in a lower stage",
    hint: "The assessment shows the child is not yet ready for the stage applied for. The offer, fees and letter change to the stage you choose.",
    detail: "grade",
    detailLabel: "Stage offered",
    text: "The place is offered in {detail} rather than {applied}. The assessment shows that {child} is not yet ready for {applied}, and starting in {detail} gives {child} the best chance to settle and succeed. The school will review progress at the end of each term.",
  },
  {
    key: "tutoring",
    label: "Extra tutoring outside school",
    hint: "Name the subject or area if you can.",
    detail: "text",
    detailLabel: "Subject or area",
    text: "{child} will need extra tutoring outside school{in_detail}. The family arranges this, and the school may ask to see evidence that it is in place.",
  },
  {
    key: "ot_report",
    label: "Occupational therapist's report",
    detail: null,
    text: "The family must give the school a report from an occupational therapist before {child} starts. Any recommendations in the report will form part of {child}'s support plan.",
  },
  {
    key: "ed_psych_report",
    label: "Educational psychologist's report",
    detail: null,
    text: "The family must give the school an educational psychologist's assessment report before {child} starts. Any recommendations in the report will form part of {child}'s support plan.",
  },
  {
    key: "speech_report",
    label: "Speech and language therapist's report",
    detail: null,
    text: "The family must give the school a speech and language therapist's report before {child} starts.",
  },
  {
    key: "language_support",
    label: "English language support",
    hint: "For a child whose English is not yet strong enough for the stage.",
    detail: null,
    text: "{child} will need English language support. The family arranges and pays for this, and the school will review {child}'s progress in English at the end of each term.",
  },
  {
    key: "probation",
    label: "Probationary first term",
    detail: null,
    text: "The place is offered on a probationary basis for the first term. Continued enrolment depends on a satisfactory report on progress, effort and behaviour at the end of that term.",
  },
  {
    key: "previous_school",
    label: "Latest report and transfer certificate before starting",
    detail: null,
    text: "The family must give the school {child}'s latest school report and a transfer certificate from the previous school before {child} starts.",
  },
  {
    key: "meeting",
    label: "Meeting with the head before starting",
    detail: null,
    text: "The parents must meet the head of school before {child} starts, to agree how the school and the family will support {child}.",
  },
];

export type ConditionSelection = {
  keys: string[];
  details: Record<string, string>;
  other: string | null;
};

/** Reads the form: `cond_<key>` checkboxes, `detail_<key>` inputs, `conditionsOther` free text. */
export function parseConditionSelection(entries: Record<string, unknown>): ConditionSelection {
  const keys = OFFER_CONDITIONS.filter((c) => entries[`cond_${c.key}`] === "1" || entries[`cond_${c.key}`] === "on").map((c) => c.key);
  const details: Record<string, string> = {};
  for (const c of OFFER_CONDITIONS) {
    const v = entries[`detail_${c.key}`];
    if (typeof v === "string" && v.trim()) details[c.key] = v.trim().slice(0, 120);
  }
  const otherRaw = entries.conditionsOther ?? entries.conditions;
  const other = typeof otherRaw === "string" && otherRaw.trim() ? otherRaw.trim().slice(0, 1000) : null;
  return { keys, details, other };
}

export type ConditionContext = {
  childFirstName: string;
  appliedGradeName: string;
  /** Resolves a grade id typed into a detail to its name. */
  gradeName: (id: string) => string | null;
};

/**
 * The parent-facing text: numbered sentences, in the order the list above
 * defines, then anything typed under "other". Null when nothing applies.
 */
export function conditionsText(sel: ConditionSelection, ctx: ConditionContext): string | null {
  const parts: string[] = [];
  for (const c of OFFER_CONDITIONS) {
    if (!sel.keys.includes(c.key)) continue;
    let detail = sel.details[c.key] ?? "";
    if (c.detail === "grade") detail = ctx.gradeName(detail) ?? detail;
    // A stage must be chosen; a free-text detail is optional.
    if (c.detail === "grade" && !detail) continue;
    parts.push(
      c.text
        .replace(/\{child\}/g, ctx.childFirstName)
        .replace(/\{applied\}/g, ctx.appliedGradeName)
        .replace(/\{detail\}/g, detail)
        .replace(/\{in_detail\}/g, detail ? ` in ${detail}` : "")
    );
  }
  if (sel.other) parts.push(sel.other.replace(/\s+/g, " "));
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : parts.map((p, i) => `(${i + 1}) ${p}`).join(" ");
}

/** The grade a "lower stage" condition moves the offer to, if one was chosen. */
export function offeredGradeId(sel: ConditionSelection): string | null {
  return sel.keys.includes("lower_stage") && sel.details.lower_stage ? sel.details.lower_stage : null;
}
