import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ApplicationRow, DecisionOutcome, Json, RuleOperator, RuleSeverity, BenchmarkScope } from "@/lib/supabase/types";
import { placesRemaining } from "@/lib/rules/capacity";
import { evaluateAdmission, type Evaluation, type Rule } from "@/lib/rules/evaluate";
import { getSettings } from "@/lib/settings";
import { commit, SYSTEM_ACTOR, WorkflowError, type Actor, type JobSpec, type TaskSpec } from "@/lib/workflow/engine";

/**
 * From "marked" to "decided". The rules engine computes an outcome; this
 * module records it and moves the application. A person's override goes
 * through {@link applyDecision} too, so both paths write the same decision
 * row, the same timeline entry and the same follow-ups.
 *
 * Nothing here sends an email. Waitlist and decline emails are queued only
 * when a person clicks Send (or the auto_send_outcomes switch is on), and
 * an approval leads to an offer that a person approves.
 */

async function activeRulesetFor(
  admin: AdminClient,
  opts: { campusId: string; gradeSort: number }
): Promise<{ id: string; version: number; rules: Rule[] } | null> {
  const { data, error } = await admin
    .from("admission_rulesets")
    .select("id, version, campus_id, admission_rules(id, scope, scope_id, operator, threshold, severity, label, position)")
    .eq("status", "active")
    .or(`grade_sort_min.is.null,grade_sort_min.lte.${opts.gradeSort}`)
    .or(`grade_sort_max.is.null,grade_sort_max.gte.${opts.gradeSort}`)
    .or(`campus_id.eq.${opts.campusId},campus_id.is.null`)
    .order("activated_at", { ascending: false });
  if (error) throw new WorkflowError(error.message, "database");
  const rows = data ?? [];
  const chosen = rows.find((r) => r.campus_id === opts.campusId) ?? rows.find((r) => r.campus_id === null) ?? null;
  if (!chosen) return null;
  const rules: Rule[] = [...(chosen.admission_rules ?? [])]
    .sort((a, b) => a.position - b.position)
    .map((r) => ({
      id: r.id,
      scope: r.scope as BenchmarkScope,
      scopeId: r.scope_id,
      operator: r.operator as RuleOperator,
      threshold: Number(r.threshold),
      severity: r.severity as RuleSeverity,
      label: r.label,
    }));
  return { id: chosen.id, version: chosen.version, rules };
}

/** Runs the rules for a marked attempt and applies the outcome. Idempotent per attempt. */
export async function evaluateAndDecide(admin: AdminClient, attemptId: string): Promise<DecisionOutcome> {
  const { data: attempt } = await admin.from("attempts").select("*").eq("id", attemptId).single();
  if (!attempt) throw new WorkflowError("attempt missing", "database");
  if (attempt.marking_status !== "complete") throw new WorkflowError("attempt not fully marked", "status_conflict");

  const { data: app } = await admin
    .from("applications")
    .select("*, grades!applications_grade_id_fkey(sort_order)")
    .eq("id", attempt.application_id)
    .single();
  if (!app) throw new WorkflowError("application missing", "database");
  if (app.status !== "awaiting_decision") {
    // Already decided (a re-run, or a person got there first). Nothing to do.
    return app.status === "staff_review" ? "staff_review" : (app.status as DecisionOutcome);
  }

  const { data: existing } = await admin
    .from("admission_decisions")
    .select("id")
    .eq("attempt_id", attemptId)
    .limit(1);
  if (existing?.length) return "staff_review";

  const grade = Array.isArray(app.grades) ? app.grades[0] : app.grades;
  const gradeSort = (grade as { sort_order: number } | null)?.sort_order ?? 0;
  const [{ data: scores }, ruleset, places] = await Promise.all([
    admin.from("attempt_scores").select("scope, scope_id, percent").eq("attempt_id", attemptId),
    activeRulesetFor(admin, { campusId: app.campus_id, gradeSort }),
    placesRemaining(admin, { campusId: app.campus_id, gradeId: app.grade_id, intakeId: app.intake_id, excludeApplicationId: app.id }),
  ]);

  const evaluation = evaluateAdmission({
    scores: (scores ?? []).map((s) => ({ scope: s.scope as BenchmarkScope, scopeId: s.scope_id, percent: Number(s.percent) })),
    rules: ruleset?.rules ?? null,
    placesRemaining: places,
  });

  await applyDecision(admin, app, {
    outcome: evaluation.outcome,
    computedOutcome: evaluation.outcome,
    attemptId,
    ruleset: ruleset ? { id: ruleset.id, version: ruleset.version } : null,
    inputs: {
      scores: (scores ?? []) as unknown as Json,
      results: evaluation.results as unknown as Json,
      places_remaining: places,
      reason: evaluation.reason,
    },
    reason: evaluation.reason,
    decidedBy: "rules",
    actor: SYSTEM_ACTOR,
  });
  return evaluation.outcome;
}

export type DecisionSpec = {
  outcome: DecisionOutcome;
  /** What the rules said, when a person overrides; equals `outcome` otherwise. */
  computedOutcome: DecisionOutcome;
  attemptId: string | null;
  ruleset: { id: string; version: number } | null;
  inputs: Record<string, Json | undefined>;
  reason: string;
  decidedBy: "rules" | "staff";
  actor: Actor;
};

/**
 * Records the decision row and moves the application. `staff_review` is a
 * referral, not a decision: it emits `decision.referred`, so the analytics'
 * "time to decision" measures the real one.
 */
export async function applyDecision(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name">,
  spec: DecisionSpec
): Promise<void> {
  const settings = await getSettings(admin);
  const { error } = await admin.from("admission_decisions").insert({
    application_id: app.id,
    attempt_id: spec.attemptId,
    ruleset_id: spec.ruleset?.id ?? null,
    ruleset_version: spec.ruleset?.version ?? null,
    inputs: spec.inputs as Json,
    computed_outcome: spec.computedOutcome,
    final_outcome: spec.outcome,
    decided_by: spec.decidedBy,
    staff_id: spec.decidedBy === "staff" ? (spec.actor.id ?? null) : null,
    override_reason: spec.decidedBy === "staff" ? spec.reason : null,
  });
  if (error) throw new WorkflowError(error.message, "database");

  const manual = spec.decidedBy === "staff";
  const payload = { outcome: spec.outcome, computed: spec.computedOutcome, reason: spec.reason, manual, attempt_id: spec.attemptId };
  const audit = {
    action: manual ? "decision.manual" : "decision.rules",
    before: { status: app.status },
    after: { status: spec.outcome, reason: spec.reason },
  };

  if (spec.outcome === "staff_review") {
    await commit(admin, {
      applicationId: app.id,
      expectedStatus: app.status,
      newStatus: "staff_review",
      nextAction: "await_decision",
      event: { type: "decision.referred", summary: `Referred for review: ${spec.reason}`, payload },
      tasks: [
        {
          type: "review_decision",
          title: `Decide on ${app.child_first_name}'s application`,
          details: spec.reason,
          priority: "high",
        },
      ],
      audit,
      actor: spec.actor,
    });
    return;
  }

  const tasks: TaskSpec[] = [];
  const jobs: JobSpec[] = [];
  let nextAction: "await_offer" | "none" = "none";

  if (spec.outcome === "approved") {
    nextAction = "await_offer";
    jobs.push({
      type: "draft_offer",
      payload: { attempt_id: spec.attemptId },
      idempotencyKey: `draft_offer:${app.id}:${Date.now()}`,
      precondition: { application_status: ["approved"] },
    });
  } else {
    const key = spec.outcome === "waitlisted" ? "outcome_waitlisted" : "outcome_declined";
    if (settings.autoSendOutcomes) {
      jobs.push({
        type: "send_outcome",
        payload: { template_key: key },
        idempotencyKey: `outcome:${app.id}:${spec.attemptId ?? "manual"}:${Date.now()}`,
        precondition: { application_status: [spec.outcome] },
      });
    } else {
      tasks.push({
        type: "send_outcome",
        title: `Send ${spec.outcome} outcome to ${app.child_first_name}'s parent`,
        details: "Review the wording and the learning profile, then click Send on the Offers & outcomes page.",
        priority: "normal",
      });
    }
  }

  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: spec.outcome,
    nextAction,
    event: { type: "decision.made", summary: `Decision: ${spec.outcome}${manual ? " (by staff)" : ""} — ${spec.reason}`, payload },
    resolveTaskTypes: ["review_decision", "review_preschool_enquiry"],
    tasks,
    jobs,
    audit,
    actor: spec.actor,
  });
}

/**
 * A person decides, from the review queue or as an override. The rules'
 * outcome (if any) is kept as the computed outcome so the override is
 * visible as one.
 */
export async function onStaffDecision(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status" | "child_first_name">,
  outcome: "approved" | "waitlisted" | "declined",
  reason: string,
  actor: Actor
): Promise<void> {
  if (actor.type !== "staff" || !actor.id) {
    throw new WorkflowError("A decision needs a signed-in member of staff", "illegal_transition");
  }
  if (reason.trim().length < 5) {
    throw new WorkflowError("A reason is required", "illegal_transition");
  }
  const { data: latest } = await admin
    .from("admission_decisions")
    .select("attempt_id, computed_outcome, ruleset_id, ruleset_version, inputs")
    .eq("application_id", app.id)
    .order("decided_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  await applyDecision(admin, app, {
    outcome,
    computedOutcome: latest?.computed_outcome ?? outcome,
    attemptId: latest?.attempt_id ?? null,
    ruleset: latest?.ruleset_id && latest.ruleset_version ? { id: latest.ruleset_id, version: latest.ruleset_version } : null,
    inputs: { previous: (latest?.inputs ?? null) as Json },
    reason,
    decidedBy: "staff",
    actor,
  });
}

/** Staff (or the automation switch) sends the waitlist or decline email. */
export async function onOutcomeSent(
  admin: AdminClient,
  app: Pick<ApplicationRow, "id" | "status">,
  actor: Actor
): Promise<void> {
  if (app.status !== "waitlisted" && app.status !== "declined") {
    throw new WorkflowError(`Application is ${app.status}; there is no outcome to send`, "status_conflict");
  }
  const settings = await getSettings(admin);
  const key = app.status === "waitlisted" ? "outcome_waitlisted" : "outcome_declined";
  const shareProfile = app.status === "waitlisted" || settings.profileSharedOnDecline;
  const { data: profile } = await admin
    .from("learning_profiles")
    .select("id")
    .eq("application_id", app.id)
    .not("published_at", "is", null)
    .limit(1);
  await commit(admin, {
    applicationId: app.id,
    expectedStatus: app.status,
    newStatus: app.status,
    nextAction: shareProfile && profile?.length ? "view_profile" : "none",
    event: { type: "outcome.sent", summary: `${app.status === "waitlisted" ? "Waitlist" : "Decline"} email sent`, payload: { template_key: key } },
    resolveTaskTypes: ["send_outcome"],
    jobs: [
      {
        type: "send_email",
        payload: { template_key: key, links: shareProfile && profile?.length ? ["results"] : [] },
        idempotencyKey: `email:${app.id}:${key}:${Date.now()}`,
      },
    ],
    audit: { action: "outcome.sent", after: { template_key: key } },
    actor,
  });
}

export type { Evaluation };
