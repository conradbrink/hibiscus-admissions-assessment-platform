import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import type { ActorType, ApplicationStatus, Json, TaskPriority } from "@/lib/supabase/types";
import { assertTransition, type NextAction } from "@/lib/workflow/states";

/**
 * The single writer of `applications.status`.
 *
 * A transition is computed here — the new status, the next action, the
 * timeline entry, the tasks to open or close, the jobs to queue, the audit
 * row — and handed to `commit_transition()` in the database, which applies
 * all of it in one transaction or none of it. This module never issues an
 * UPDATE on `applications` directly.
 *
 * Everything that changes an application's place in the pipeline goes
 * through {@link commit}. The named operations in `actions.ts` are the only
 * callers; pages and route handlers call those.
 */

export type Actor = {
  type: ActorType;
  id?: string | null;
  /** Readable identity for the audit trail: a staff email, "Parent (via link)". */
  label?: string | null;
  ipHash?: string | null;
};

export const SYSTEM_ACTOR: Actor = { type: "system", label: "System" };
export const PARENT_ACTOR: Actor = { type: "parent", label: "Parent (via link)" };

export type TaskSpec = {
  type: string;
  title: string;
  details?: string;
  priority?: TaskPriority;
  dueAt?: Date | null;
  assigneeStaffId?: string | null;
};

export type JobPrecondition = {
  application_status?: ApplicationStatus[];
  booking_id?: string;
  booking_status?: string[];
  attempt_id?: string;
  attempt_status?: string[];
  offer_id?: string;
  offer_status?: string[];
};

export type JobSpec = {
  type: string;
  payload?: Record<string, Json | undefined>;
  idempotencyKey: string;
  runAfter?: Date;
  precondition?: JobPrecondition;
};

export type TransitionSpec = {
  applicationId: string;
  /** The status the caller believes the application is in. Null skips the check. */
  expectedStatus: ApplicationStatus | null;
  /** Null records an event without touching the application. */
  newStatus: ApplicationStatus | null;
  nextAction: NextAction | null;
  nextActionDueAt?: Date | null;
  event: { type: string; summary: string; payload?: Record<string, Json | undefined> };
  tasks?: TaskSpec[];
  resolveTaskTypes?: string[];
  jobs?: JobSpec[];
  audit?: {
    action: string;
    entityType?: string;
    entityId?: string;
    before?: Json;
    after?: Json;
  };
  actor: Actor;
};

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "status_conflict"
      | "application_not_found"
      | "illegal_transition"
      | "database"
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

function stripUndefined(obj: Record<string, Json | undefined> | undefined): Json {
  if (!obj) return {};
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Applies a transition atomically. Returns the timeline event id.
 *
 * Checks legality before the round trip so an illegal move is a thrown
 * `WorkflowError` with a clear message rather than a database error.
 */
export async function commit(admin: AdminClient, spec: TransitionSpec): Promise<number> {
  if (spec.expectedStatus && spec.newStatus && spec.expectedStatus !== spec.newStatus) {
    assertTransition(spec.expectedStatus, spec.newStatus);
  }

  const { data, error } = await admin.rpc("commit_transition", {
    p_application_id: spec.applicationId,
    p_expected_status: spec.expectedStatus,
    p_new_status: spec.newStatus,
    p_next_action: spec.nextAction,
    p_next_action_due_at: spec.nextActionDueAt ? spec.nextActionDueAt.toISOString() : null,
    p_event: {
      type: spec.event.type,
      summary: spec.event.summary,
      payload: stripUndefined(spec.event.payload),
      actor_type: spec.actor.type,
      actor_id: spec.actor.id ?? null,
    },
    p_tasks: (spec.tasks ?? []).map((t) => ({
      type: t.type,
      title: t.title,
      details: t.details ?? null,
      priority: t.priority ?? "normal",
      due_at: t.dueAt ? t.dueAt.toISOString() : null,
      assignee_staff_id: t.assigneeStaffId ?? null,
    })),
    p_resolve_task_types: spec.resolveTaskTypes ?? [],
    p_jobs: (spec.jobs ?? []).map((j) => ({
      type: j.type,
      payload: stripUndefined(j.payload),
      idempotency_key: j.idempotencyKey,
      run_after: j.runAfter ? j.runAfter.toISOString() : null,
      precondition: j.precondition ? (j.precondition as Json) : null,
    })),
    p_audit: spec.audit
      ? {
          action: spec.audit.action,
          entity_type: spec.audit.entityType ?? "application",
          entity_id: spec.audit.entityId ?? null,
          before: spec.audit.before ?? null,
          after: spec.audit.after ?? null,
          actor_label: spec.actor.label ?? null,
          ip_hash: spec.actor.ipHash ?? null,
        }
      : null,
  });

  if (error) {
    if (error.message.startsWith("status_conflict")) {
      throw new WorkflowError(error.message, "status_conflict");
    }
    if (error.message.startsWith("application_not_found")) {
      throw new WorkflowError(error.message, "application_not_found");
    }
    throw new WorkflowError(error.message, "database");
  }
  return data as number;
}

/** Hours from now, as a Date. */
export function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}

/** Hours before an instant, as a Date. */
export function hoursBefore(instant: Date, hours: number): Date {
  return new Date(instant.getTime() - hours * 3_600_000);
}
