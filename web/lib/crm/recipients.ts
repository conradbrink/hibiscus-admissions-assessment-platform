import { TRANSACTIONAL_CATEGORIES } from "@/lib/crm/labels";
import type { CampaignCategory, CampaignChannel } from "@/lib/supabase/types";

/**
 * Who a campaign actually reaches, and why the rest do not.
 *
 * The audience is a list of families; the recipients are the contacts on
 * them who may be written to on the chosen channel. A marketing campaign
 * needs the contact's marketing consent for that channel; a service
 * campaign (a fee notice, a policy) needs only a working address. WhatsApp
 * additionally needs the updates opt-in and a number the provider can
 * reach — the same two things `sendFamilyMessage` checks, so what this
 * excludes is exactly what that would have skipped.
 *
 * Every exclusion carries a reason, counted, because "127 recipients" is
 * only half the sentence the approver needs. Pure and tested.
 */

export type RecipientContact = {
  id: string;
  family_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  mobile_normalised: string | null;
  whatsapp_opt_in: boolean;
  marketing_email_consent: boolean;
  marketing_whatsapp_consent: boolean;
  unsubscribed_at: string | null;
  is_active: boolean;
  /** Only the primary contact is written to unless the campaign asks for every contact. */
  is_primary: boolean;
};

export type ExclusionReason =
  | "no_consent_email"
  | "no_consent_whatsapp"
  | "unsubscribed"
  | "whatsapp_updates_off"
  | "invalid_email"
  | "invalid_number"
  | "contact_inactive"
  | "not_primary";

export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  no_consent_email: "No consent to marketing email",
  no_consent_whatsapp: "No consent to marketing WhatsApp",
  unsubscribed: "Unsubscribed",
  whatsapp_updates_off: "WhatsApp updates switched off",
  invalid_email: "No usable email address",
  invalid_number: "No usable mobile number",
  contact_inactive: "Contact no longer active",
  not_primary: "Not the family's primary contact",
};

export type PlannedRecipient = { contactId: string; familyId: string; channel: "email" | "whatsapp" };
export type PlannedExclusion = { contactId: string; familyId: string; channel: "email" | "whatsapp"; reason: ExclusionReason };

export type RecipientPlan = {
  recipients: PlannedRecipient[];
  excluded: PlannedExclusion[];
  /** Distinct families that will hear from us on at least one channel. */
  familiesReached: number;
  email: number;
  whatsapp: number;
  /** Count per reason, for the approval screen. */
  exclusionCounts: Partial<Record<ExclusionReason, number>>;
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export function isTransactional(category: CampaignCategory): boolean {
  return TRANSACTIONAL_CATEGORIES.has(category);
}

export function planRecipients(
  contacts: readonly RecipientContact[],
  opts: { channel: CampaignChannel; category: CampaignCategory; everyContact?: boolean }
): RecipientPlan {
  const transactional = isTransactional(opts.category);
  const channels: Array<"email" | "whatsapp"> = opts.channel === "both" ? ["email", "whatsapp"] : [opts.channel];
  const recipients: PlannedRecipient[] = [];
  const excluded: PlannedExclusion[] = [];
  const families = new Set<string>();

  for (const c of contacts) {
    for (const channel of channels) {
      const reason = exclusionFor(c, channel, transactional, opts.everyContact ?? false);
      if (reason) {
        excluded.push({ contactId: c.id, familyId: c.family_id, channel, reason });
        continue;
      }
      recipients.push({ contactId: c.id, familyId: c.family_id, channel });
      families.add(c.family_id);
    }
  }

  const exclusionCounts: Partial<Record<ExclusionReason, number>> = {};
  for (const e of excluded) exclusionCounts[e.reason] = (exclusionCounts[e.reason] ?? 0) + 1;

  return {
    recipients,
    excluded,
    familiesReached: families.size,
    email: recipients.filter((r) => r.channel === "email").length,
    whatsapp: recipients.filter((r) => r.channel === "whatsapp").length,
    exclusionCounts,
  };
}

/** Null when the contact may be written to on this channel; otherwise why not. */
export function exclusionFor(c: RecipientContact, channel: "email" | "whatsapp", transactional: boolean, everyContact: boolean): ExclusionReason | null {
  if (!c.is_active) return "contact_inactive";
  if (!everyContact && !c.is_primary) return "not_primary";
  if (channel === "email") {
    if (!c.email || !EMAIL_SHAPE.test(c.email)) return "invalid_email";
    if (!transactional) {
      if (c.unsubscribed_at) return "unsubscribed";
      if (!c.marketing_email_consent) return "no_consent_email";
    }
    return null;
  }
  if (!c.mobile_normalised || !E164.test(c.mobile_normalised)) return "invalid_number";
  if (!c.whatsapp_opt_in) return "whatsapp_updates_off";
  if (!transactional && !c.marketing_whatsapp_consent) return "no_consent_whatsapp";
  return null;
}
