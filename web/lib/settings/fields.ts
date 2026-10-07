/**
 * What each workflow setting is, so the screen can ask for it properly.
 *
 * `public.settings` holds JSON, and the editor asked for JSON: one box per
 * row, the key in monospace, `JSON.stringify(value)` inside it. That is a
 * developer's tool. To move the reminders you typed `[7, 2]`; to move the
 * scholarship deadline you typed `"2026-10-17"` and the save refused it,
 * because it accepted only a boolean, a positive integer or a list of them.
 * Four live settings — the interview deadline, the parent guide link, the SMS
 * sender and the auto-reply text — could not be edited from the console at
 * all, and the only way to move that deadline was SQL.
 *
 * So each key says what kind of thing it is and what to call it. The kinds
 * mirror the readers in `lib/settings.ts` exactly, which is the point: a value
 * this accepts is one `getSettings` will honour rather than silently replace
 * with a default.
 *
 * A key absent from the catalogue is not an error and must not become
 * uneditable — a migration adds a row before anybody labels it. Those fall
 * back to the raw JSON box, which is what the whole page used to be.
 */

export type SettingKind =
  /** A whole number above zero. */
  | "int"
  /** A whole number from zero up: an offset of none is a real answer. */
  | "int0"
  /** An hour of the day, 0 to 23. Midnight is 0, and 0 is not "unset". */
  | "hour"
  /** Whole numbers above zero, comma separated. */
  | "intList"
  /** The same, where zero means "on the day itself". */
  | "intList0"
  /** Clock times, stored as minutes after midnight, ascending and distinct. */
  | "timeList"
  | "bool"
  | "date"
  | "text";

export type SettingField = {
  kind: SettingKind;
  /** What it is called, in the words somebody running admissions would use. */
  label: string;
  /** What changing it does, where that is not obvious from the label. */
  help?: string;
  /** Shown after the box: "days", "minutes". */
  unit?: string;
  section: string;
};

export const SECTIONS = [
  "Offers and payment",
  "Bookings and assessments",
  "Reminders and nudges",
  "Parent links",
  "Messaging",
  "Scholarships",
  "Automation",
  "CRM",
  "Keeping and deleting data",
  "Everything else",
] as const;

const F = (kind: SettingKind, section: string, label: string, extra: Partial<SettingField> = {}): SettingField => ({ kind, section, label, ...extra });

export const SETTING_FIELDS: Record<string, SettingField> = {
  // Offers and payment
  offer_expiry_days: F("int", "Offers and payment", "An offer stays open for", { unit: "days", help: "Counted from the day it is sent. Offers already sent keep the date they were sent with." }),
  offer_reminder_days_before: F("intList", "Offers and payment", "Remind the family before an offer expires", { unit: "days before", help: "One number per reminder, so 7, 2 sends two." }),
  payment_due_days: F("int", "Offers and payment", "Fees are due after accepting", { unit: "days", help: "A family already past acceptance keeps their own date — move that on their Payment tab." }),
  payment_reminder_days_before: F("intList", "Offers and payment", "Remind the family before fees are due", { unit: "days before" }),
  payment_attempt_minutes: F("int", "Offers and payment", "Wait on a card payment the parent started for", { unit: "minutes", help: "Then the attempt is marked not completed. A payment that lands later still settles." }),
  payment_verify_minutes: F("int", "Offers and payment", "Re-check an unconfirmed payment every", { unit: "minutes" }),
  offer_auto_approve: F("bool", "Offers and payment", "Send offers without a second person approving them"),

  // Bookings and assessments
  reschedule_cutoff_hours: F("int", "Bookings and assessments", "Parents can no longer change a booking within", { unit: "hours", help: "Inside this window the page asks them to call instead." }),
  auto_sessions_enabled: F("bool", "Bookings and assessments", "Open bookable sittings automatically"),
  auto_sessions_weeks_ahead: F("int", "Bookings and assessments", "Keep sittings open", { unit: "weeks ahead" }),
  auto_assessment_starts: F("timeList", "Bookings and assessments", "Assessment sittings start at", { help: "Clock times, earliest first." }),
  auto_assessment_duration_minutes: F("int", "Bookings and assessments", "An assessment sitting lasts", { unit: "minutes" }),
  auto_visit_starts: F("timeList", "Bookings and assessments", "Visits start at"),
  auto_visit_duration_minutes: F("int", "Bookings and assessments", "A visit lasts", { unit: "minutes" }),
  auto_session_capacity: F("int", "Bookings and assessments", "Children per sitting", { unit: "places" }),
  kiosk_code_minutes: F("int", "Bookings and assessments", "A launch code for the assessment computer lasts", { unit: "minutes" }),
  attempt_grace_seconds: F("int", "Bookings and assessments", "Grace added to an assessment attempt", { unit: "seconds" }),

  // Reminders and nudges
  assessment_reminder_hours: F("intList", "Reminders and nudges", "Remind the family before an assessment", { unit: "hours before" }),
  enquiry_nudge_hours: F("int", "Reminders and nudges", "Nudge an enquiry with no booking after", { unit: "hours" }),
  rebook_nudge_days: F("int", "Reminders and nudges", "Nudge to rebook after a missed sitting", { unit: "days later" }),
  registration_reminder_days: F("intList", "Reminders and nudges", "Remind an unfinished registration", { unit: "days after paying" }),
  documents_reminder_days: F("int", "Reminders and nudges", "Remind about outstanding documents after", { unit: "days" }),
  deferral_follow_up_days_before: F("intList0", "Reminders and nudges", "Follow up a deferred family before the date they named", { unit: "days before", help: "Zero is the morning of the date itself, which is why zero is allowed here." }),
  digest_enabled: F("bool", "Reminders and nudges", "Send staff the daily digest"),
  digest_hour: F("hour", "Reminders and nudges", "Send the digest at", { help: "The hour in school time. 0 is midnight." }),

  // Parent links
  booking_token_days: F("int", "Parent links", "A “book my assessment” link lasts", { unit: "days" }),
  next_step_token_days: F("int", "Parent links", "A “your next step” link lasts", { unit: "days" }),
  parent_session_minutes: F("int", "Parent links", "A parent stays signed in for", { unit: "minutes" }),
  family_session_minutes: F("int", "Parent links", "A family keeps the details form open for", { unit: "minutes", help: "Longer than a parent session: it is a dozen questions on a phone." }),
  parent_guide_url: F("text", "Parent links", "Link to the parent guide", { help: "Blank leaves it out of the emails." }),

  // Messaging
  whatsapp_enabled: F("bool", "Messaging", "Send WhatsApp messages"),
  whatsapp_auto_reply_enabled: F("bool", "Messaging", "Answer a parent who replies to the updates number"),
  whatsapp_auto_reply_text: F("text", "Messaging", "What that answer says", { help: "The updates number is not read by anybody, so this should say where to write instead." }),
  sms_enabled: F("bool", "Messaging", "Send SMS"),
  sms_sender_id: F("text", "Messaging", "SMS sender name"),

  // Scholarships
  scholarship_interview_deadline: F("date", "Scholarships", "Last day a scholarship family may book an interview", { help: "The booking page offers no later slot, and the invitation quotes this date. It was put to the families in writing, so moving it is a decision, not a tidy-up." }),

  // Automation
  auto_send_outcomes: F("bool", "Automation", "Send outcome letters without a person pressing Send"),
  auto_enrol: F("bool", "Automation", "Enrol a child once registration is complete"),
  waitlist_auto_promote: F("bool", "Automation", "Promote from the waiting list when a place frees up"),
  reenrolment_asks_enabled: F("bool", "Automation", "Send the re-enrolment ask and its reminders"),
  onboarding_journey_enabled: F("bool", "Automation", "Send the joining-up messages to a new family"),
  profile_shared_on_decline: F("bool", "Automation", "Share the learning profile when a child is declined"),
  staff_mfa_required: F("bool", "Automation", "Require staff to use a second factor to sign in"),
  ai_summary_enabled: F("bool", "Automation", "Let the model write the applicant summary"),
  ai_narrative_enabled: F("bool", "Automation", "Let the model write the learning profile prose"),
  ai_extraction_enabled: F("bool", "Automation", "Read uploaded documents with the model"),
  ai_auto_mark_enabled: F("bool", "Automation", "Mark written answers with the model", { help: "A suggestion for a marker to accept or change; it never decides an outcome." }),

  // CRM
  crm_automations_enabled: F("bool", "CRM", "Run the CRM automations"),
  crm_opportunity_engine_enabled: F("bool", "CRM", "Create opportunities automatically"),
  crm_campaign_approval_required: F("bool", "CRM", "A campaign needs signing off before it sends"),
  crm_follow_up_days: F("int", "CRM", "A new enquiry should be contacted within", { unit: "days" }),
  crm_stale_contact_days: F("int", "CRM", "Count a family as “no response” after", { unit: "days" }),

  // Keeping and deleting data
  retention_enabled: F("bool", "Keeping and deleting data", "Anonymise old applications automatically"),
  retention_days_abandoned: F("int", "Keeping and deleting data", "Anonymise an enquiry that never progressed after", { unit: "days" }),
  retention_days_closed: F("int", "Keeping and deleting data", "Anonymise a closed application after", { unit: "days" }),
};

/** The field for a key, or null when nothing has labelled it yet. */
export function fieldFor(key: string): SettingField | null {
  return SETTING_FIELDS[key] ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A stored value, as the control should show it. */
export function formatSetting(kind: SettingKind, value: unknown): string {
  if (kind === "bool") return value === true ? "1" : "";
  if (kind === "timeList") {
    return Array.isArray(value) ? value.filter((v): v is number => typeof v === "number").map((m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`).join(", ") : "";
  }
  if (kind === "intList" || kind === "intList0") {
    return Array.isArray(value) ? value.join(", ") : "";
  }
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return "";
}

function wholeNumbers(raw: string, min: number, what: string): number[] {
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < min) throw new Error(`${what}: "${s}" is not a whole number${min > 0 ? " above zero" : " of zero or more"}.`);
    return n;
  });
}

/**
 * What to store for a typed box, or a message saying why not.
 *
 * Deliberately stricter than the reader. `getSettings` falls back to a default
 * when a value is malformed, which is right at read time and wrong here: a
 * school that typed something wrong should be told, not quietly given the
 * default and left believing the typing worked.
 */
export function parseSetting(kind: SettingKind, raw: string, label: string): string | number | boolean | number[] {
  const value = raw.trim();
  switch (kind) {
    case "bool":
      return value === "1";
    case "int":
    case "int0": {
      const [n, ...rest] = wholeNumbers(value, kind === "int" ? 1 : 0, label);
      if (n === undefined || rest.length) throw new Error(`${label}: enter one whole number.`);
      return n;
    }
    case "hour": {
      const [n, ...rest] = wholeNumbers(value, 0, label);
      if (n === undefined || rest.length || n > 23) throw new Error(`${label}: enter an hour from 0 to 23.`);
      return n;
    }
    case "intList":
    case "intList0": {
      const nums = wholeNumbers(value, kind === "intList" ? 1 : 0, label);
      if (!nums.length) throw new Error(`${label}: enter at least one number, or several separated by commas.`);
      return nums;
    }
    case "timeList": {
      const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!parts.length) throw new Error(`${label}: enter at least one time, like 08:00.`);
      const minutes = parts.map((s) => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(s);
        if (!m) throw new Error(`${label}: "${s}" is not a time. Write them like 08:00.`);
        const h = Number(m[1]);
        const min = Number(m[2]);
        if (h > 23 || min > 59) throw new Error(`${label}: "${s}" is not a time of day.`);
        return h * 60 + min;
      });
      // Ascending and distinct, because `asMinutesList` discards the whole
      // list otherwise — and a sitting generator quietly running fewer
      // sittings than the school asked for is the failure that causes.
      for (let i = 1; i < minutes.length; i++) {
        if (minutes[i] <= minutes[i - 1]) throw new Error(`${label}: put the times in order, earliest first, with no repeats.`);
      }
      return minutes;
    }
    case "date": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label}: choose a date.`);
      return value;
    }
    case "text":
      return value;
  }
}
