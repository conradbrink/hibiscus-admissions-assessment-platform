import type {
  CampaignCategory,
  CampaignChannel,
  CampaignStatus,
  ContactChannel,
  CrmEventKind,
  EventRegistrationStatus,
  GuardianRelationship,
  NotificationKind,
  OpportunityStatus,
} from "@/lib/supabase/types";

/**
 * How the CRM reads. Staff-facing, so denser than the parent wording, and
 * one word for one thing throughout.
 */

type Tone = "default" | "secondary" | "info" | "success" | "warning" | "muted" | "destructive";

export const OPPORTUNITY_STATUSES: readonly OpportunityStatus[] = ["identified", "contacted", "interested", "registered", "lost"];

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatus, string> = {
  identified: "Identified",
  contacted: "Contacted",
  interested: "Interested",
  registered: "Registered",
  lost: "Lost",
};

export const OPPORTUNITY_STATUS_TONE: Record<OpportunityStatus, Tone> = {
  identified: "info",
  contacted: "secondary",
  interested: "warning",
  registered: "success",
  lost: "muted",
};

export const OPEN_OPPORTUNITY_STATUSES: ReadonlySet<OpportunityStatus> = new Set(["identified", "contacted", "interested"]);

export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
  "sending",
  "sent",
  "paused",
  "cancelled",
];

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  paused: "Paused",
  cancelled: "Cancelled",
};

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, Tone> = {
  draft: "muted",
  pending_approval: "warning",
  approved: "info",
  scheduled: "info",
  sending: "secondary",
  sent: "success",
  paused: "warning",
  cancelled: "muted",
};

export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  both: "WhatsApp and email",
};

export const CAMPAIGN_CATEGORY_LABELS: Record<CampaignCategory, string> = {
  general: "General",
  promotion: "Promotion",
  event: "Event invitation",
  reenrolment: "Re-enrolment",
  fee_notice: "Fee notice",
  policy: "Policy announcement",
  announcement: "Group-wide announcement",
};

/**
 * The categories the school called high-risk: a second, senior approval
 * (`crm.campaigns.approve_sensitive`) and no marketing consent needed,
 * because they are service messages every family must receive.
 */
export const SENSITIVE_CATEGORIES: ReadonlySet<CampaignCategory> = new Set(["fee_notice", "policy", "announcement"]);

/** Categories that are service communications rather than marketing. */
export const TRANSACTIONAL_CATEGORIES: ReadonlySet<CampaignCategory> = new Set(["fee_notice", "policy", "announcement", "reenrolment"]);

export const EVENT_KIND_LABELS: Record<CrmEventKind, string> = {
  open_day: "Open day",
  robotics_makeathon: "Robotics Make-a-Thon",
  parent_meeting: "Parent meeting",
  sports_day: "Sports day",
  information_session: "Information session",
  holiday_programme: "Holiday programme",
  other: "Other",
};

export const EVENT_REGISTRATION_LABELS: Record<EventRegistrationStatus, string> = {
  invited: "Invited",
  registered: "Registered",
  attended: "Attended",
  no_show: "Did not attend",
  cancelled: "Cancelled",
};

export const EVENT_REGISTRATION_TONE: Record<EventRegistrationStatus, Tone> = {
  invited: "muted",
  registered: "info",
  attended: "success",
  no_show: "warning",
  cancelled: "muted",
};

export const RELATIONSHIP_LABELS: Record<GuardianRelationship, string> = {
  mother: "Mother",
  father: "Father",
  parent: "Parent",
  guardian: "Guardian",
  grandparent: "Grandparent",
  other: "Other",
};

export const CHANNEL_LABELS: Record<ContactChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  phone: "Phone call",
  sms: "SMS",
};

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  enquiry: "New enquiry",
  task_assigned: "Task assigned",
  task_overdue: "Task overdue",
  whatsapp_reply: "WhatsApp reply",
  email_reply: "Email reply",
  campaign_approval_requested: "Campaign to approve",
  campaign_approved: "Campaign approved",
  campaign_rejected: "Campaign sent back",
  campaign_sent: "Campaign sent",
  opportunity_created: "Opportunity",
  family_activity: "Family activity",
  import_finished: "Import finished",
  other: "Notice",
};

/** The name the school would say: "Brink family". */
export function familyName(f: { display_name: string | null; family_code: string }): string {
  return f.display_name?.trim() ? `${f.display_name.trim()} family` : `Family ${f.family_code}`;
}

export function contactName(c: { first_name: string; last_name: string }): string {
  return `${c.first_name} ${c.last_name}`.trim();
}
