import { can, canAccessPath, type PermissionCode, type PermissionSet } from "@/lib/permissions";
import type { ApplicationStatus } from "@/lib/supabase/types";

/**
 * The admissions journey as staff see it: six stages over the twenty-odd
 * statuses the engine keeps. New, Assessment, Decision, Offer, Enrolment,
 * Completed.
 *
 * Presentation only. The engine, the transitions and every query that reads
 * a status are untouched; this decides which tab an applicant is counted
 * under and which list a tab opens. Pure, like `states.ts`, because both the
 * menu (in the browser) and the pages (on the server) read it.
 *
 * A primary family's look-around visit and a pre-school family's visit sit
 * under Assessment: it is the step where the school meets the child. Waiting
 * for a place, declined, deferred and withdrawn are in no stage, because none
 * of them is a step anybody is working through; they are found under All by
 * their status, and an outcome letter still to send waits under Offer.
 */
export type StageKey = "new" | "assessment" | "decision" | "offer" | "enrolment" | "completed";

export const STAGES: ReadonlyArray<{ key: StageKey; label: string; statuses: readonly ApplicationStatus[] }> = [
  { key: "new", label: "New", statuses: ["new_enquiry", "callback_requested"] },
  {
    key: "assessment",
    label: "Assessment",
    statuses: ["visit_booked", "assessment_booked", "no_show", "assessment_in_progress", "assessment_completed"],
  },
  { key: "decision", label: "Decision", statuses: ["awaiting_decision", "staff_review"] },
  {
    key: "offer",
    label: "Offer",
    statuses: ["approved", "offer_draft", "offer_pending_approval", "offer_sent", "offer_expired", "offer_declined"],
  },
  {
    key: "enrolment",
    label: "Enrolment",
    statuses: ["offer_accepted", "payment_required", "payment_processing", "paid", "registration_incomplete", "registration_complete"],
  },
  { key: "completed", label: "Completed", statuses: ["enrolled"] },
];

/** Paused or closed: under All, by their own status, and in no stage. */
export const OUTSIDE_STAGES: readonly ApplicationStatus[] = ["deferred", "waitlisted", "declined", "withdrawn"];

export function isStageKey(value: string | null | undefined): value is StageKey {
  return STAGES.some((s) => s.key === value);
}

export function stageOf(status: ApplicationStatus): StageKey | null {
  return STAGES.find((s) => s.statuses.includes(status))?.key ?? null;
}

export function stageLabel(stage: StageKey): string {
  return STAGES.find((s) => s.key === stage)?.label ?? stage;
}

/** The applicant list, narrowed to one stage or (with none) every applicant still in play. */
export function listHref(stage?: StageKey): string {
  return stage ? `/staff/applications?stage=${stage}` : "/staff/applications";
}

/**
 * One way of looking at a stage: the board where its work is done, or the
 * applicant list narrowed to it. Every stage has the list, so a stage can
 * always be searched and filtered like the rest; the boards are the screens
 * that used to be menu items of their own.
 */
export type StageView = { key: string; label: string; href: string; permission: PermissionCode };

const list = (stage?: StageKey): StageView => ({ key: "list", label: "List", href: listHref(stage), permission: "applications.read" });

export const STAGE_VIEWS: Record<StageKey | "all", readonly StageView[]> = {
  all: [list()],
  new: [list("new")],
  assessment: [
    { key: "today", label: "Today's assessments", href: "/staff/assessments/today", permission: "assessments.deliver" },
    list("assessment"),
  ],
  decision: [{ key: "queue", label: "Review queue", href: "/staff/decisions", permission: "applications.read" }, list("decision")],
  offer: [{ key: "offers", label: "Offers", href: "/staff/offers", permission: "offers.read" }, list("offer")],
  enrolment: [
    { key: "payments", label: "Payments", href: "/staff/payments", permission: "finance.read" },
    { key: "registrations", label: "Registrations", href: "/staff/registrations", permission: "applications.read" },
    { key: "export", label: "Student export", href: "/staff/enrolment/exports", permission: "enrolment.export" },
    list("enrolment"),
  ],
  completed: [list("completed")],
};

/**
 * Both the permission the view names and the one the proxy maps its path to,
 * so a tab is never offered that the proxy would bounce.
 */
export function canOpen(permissions: PermissionSet, href: string, permission: PermissionCode): boolean {
  return can(permissions, permission) && canAccessPath(permissions, href.split("?")[0]);
}

export function visibleViews(permissions: PermissionSet, stage: StageKey | "all"): StageView[] {
  return STAGE_VIEWS[stage].filter((v) => canOpen(permissions, v.href, v.permission));
}

/** Every page the Admissions menu item stands for, so it stays lit on all of them. */
export const ADMISSIONS_PATHS: readonly string[] = [
  "/staff/applications",
  "/staff/assessments",
  "/staff/decisions",
  "/staff/offers",
  "/staff/payments",
  "/staff/registrations",
  "/staff/enrolment",
];

/** Where the Admissions menu item opens: the first view this person may see, the full list first. */
export const ADMISSIONS_ENTRIES: ReadonlyArray<{ href: string; permission: PermissionCode }> = (["all", "assessment", "decision", "offer", "enrolment"] as const).flatMap(
  (stage) => STAGE_VIEWS[stage].map((v) => ({ href: v.href, permission: v.permission }))
);
