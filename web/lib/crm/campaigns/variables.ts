import { renderHtml, renderSubject, renderText, validateTemplate, type TemplateProblem, type TemplateVariables } from "@/lib/email/render";

/**
 * What a campaign email may say about the family it is going to.
 *
 * The same renderer as every other email, the same allow-list discipline:
 * a variable outside this list fails validation when the campaign is saved,
 * never in a parent's inbox as a literal "{{parent_frist_name}}". The
 * unsubscribe link is appended to every marketing body by the sender
 * whether or not the author wrote it, because the law does not care what
 * the author wrote.
 */

export const CAMPAIGN_VARIABLES = [
  "parent_first_name",
  "parent_last_name",
  "family_name",
  "campus",
  "campus_phone",
  "student_first_name",
  "student_names",
  "unsubscribe_link",
  "family_link",
  "event_name",
  "event_date",
  "event_location",
] as const;

export type CampaignVariable = (typeof CAMPAIGN_VARIABLES)[number];

export const CAMPAIGN_VARIABLE_HINTS: Record<CampaignVariable, string> = {
  parent_first_name: "The contact's first name",
  parent_last_name: "The contact's surname",
  family_name: "The family's name, e.g. Brink",
  campus: "The family's campus",
  campus_phone: "The campus phone number",
  student_first_name: "The first name of the family's youngest enrolled child",
  student_names: "The first names of every enrolled child, joined with \"and\"",
  unsubscribe_link: "Where the parent can stop marketing email (appended automatically)",
  family_link: "A link to the family's own pages (only when the campaign asks for one)",
  event_name: "The event this campaign invites them to, when it has one",
  event_date: "When the event is",
  event_location: "Where the event is",
};

export type CampaignFamilyContext = {
  contact: { first_name: string; last_name: string; unsubscribe_token: string };
  family: { display_name: string | null; family_code: string };
  campus: { name: string; phone: string | null } | null;
  students: ReadonlyArray<{ preferred_name: string | null; legal_first_name: string; date_of_birth: string; status: string }>;
  event: { name: string; when: string; location: string | null } | null;
  siteUrl: string;
  familyLink: string | null;
};

/** The names of the children who are with us, youngest first. */
function enrolledNames(students: CampaignFamilyContext["students"]): string[] {
  return [...students]
    .filter((s) => s.status === "onboarding" || s.status === "active" || s.status === "on_leave")
    .sort((a, b) => (a.date_of_birth < b.date_of_birth ? 1 : -1))
    .map((s) => s.preferred_name || s.legal_first_name);
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function buildCampaignVariables(ctx: CampaignFamilyContext): TemplateVariables {
  const names = enrolledNames(ctx.students);
  return {
    parent_first_name: ctx.contact.first_name,
    parent_last_name: ctx.contact.last_name,
    family_name: ctx.family.display_name?.trim() || ctx.family.family_code,
    campus: ctx.campus?.name ?? "Hibiscus",
    campus_phone: ctx.campus?.phone ?? null,
    student_first_name: names[0] ?? null,
    student_names: names.length ? joinNames(names) : null,
    unsubscribe_link: `${ctx.siteUrl.replace(/\/+$/, "")}/unsubscribe/${ctx.contact.unsubscribe_token}`,
    family_link: ctx.familyLink,
    event_name: ctx.event?.name ?? null,
    event_date: ctx.event?.when ?? null,
    event_location: ctx.event?.location ?? null,
  };
}

export function validateCampaignBody(subject: string, html: string, text: string): TemplateProblem[] {
  return [...validateTemplate(subject, CAMPAIGN_VARIABLES), ...validateTemplate(html, CAMPAIGN_VARIABLES), ...validateTemplate(text, CAMPAIGN_VARIABLES)];
}

const UNSUBSCRIBE_HTML = '<p style="font-size:12px;color:#6b625c;margin-top:24px;">You are receiving this because you told Hibiscus International Schools we may write to you. <a href="{{unsubscribe_link}}">Stop marketing email</a>.</p>';
const UNSUBSCRIBE_TEXT = "\n\nYou are receiving this because you told Hibiscus International Schools we may write to you. To stop marketing email: {{unsubscribe_link}}";

/**
 * Renders a campaign for one family. A marketing campaign gets the
 * unsubscribe footer added; a service one (a fee notice) does not, because
 * a parent cannot opt out of being told their fees changed.
 */
export function renderCampaign(
  campaign: { email_subject: string; email_body_html: string; email_body_text: string },
  vars: TemplateVariables,
  opts: { marketing: boolean }
): { subject: string; html: string; text: string } {
  const html = opts.marketing && !campaign.email_body_html.includes("unsubscribe_link") ? campaign.email_body_html + UNSUBSCRIBE_HTML : campaign.email_body_html;
  const text = opts.marketing && !campaign.email_body_text.includes("unsubscribe_link") ? campaign.email_body_text + UNSUBSCRIBE_TEXT : campaign.email_body_text;
  return {
    subject: renderSubject(campaign.email_subject, vars, CAMPAIGN_VARIABLES),
    html: renderHtml(html, vars, CAMPAIGN_VARIABLES),
    text: renderText(text, vars, CAMPAIGN_VARIABLES),
  };
}

/** Plain text to HTML paragraphs, for an author who writes the email once. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}
