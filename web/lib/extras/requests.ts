import "server-only";
import type { AdminClient } from "@/lib/supabase/admin";
import { earliestOrderBy, orderLines, outstandingTotal, type LabelledItem, type SelectionLike } from "@/lib/extras/catalogue";
import { subjectColumns } from "@/lib/payments/subject";
import { OPEN_REQUEST_STATUSES } from "@/lib/payments/requests";
import type { Json, PaymentRequestRow, StudentOptionalSelectionRow } from "@/lib/supabase/types";
import { WorkflowError } from "@/lib/workflow/engine";

/**
 * Turning one child's chosen extras into something that can be paid for.
 *
 * The rule is the same as the admissions request: the figures are copied at
 * the moment the request is raised and never recomputed afterwards. A family
 * who adds a lunch plan while a stationery order is mid-payment gets a second
 * request when the first settles, rather than watching the amount on the
 * gateway page change under them.
 *
 * `payment_request_id` is stamped on the lines as the request is raised, which
 * is what makes that true: the sweep that settles a request only ever touches
 * the lines that were in it.
 */

const FOURTEEN_DAYS = 14 * 86_400_000;

/** The open request for this child, if one is already waiting to be paid. */
export async function loadOpenExtrasRequest(admin: AdminClient, studentId: string): Promise<PaymentRequestRow | null> {
  const { data, error } = await admin
    .from("payment_requests")
    .select("*")
    .eq("student_id", studentId)
    .in("status", [...OPEN_REQUEST_STATUSES])
    .maybeSingle();
  if (error) throw new WorkflowError(error.message, "database");
  return data;
}

/**
 * Raise a request over everything this child has chosen and not yet paid for.
 *
 * Returns the existing open request unchanged when there is one: the unique
 * index would refuse a second anyway, and a parent who taps Pay twice should
 * arrive at the same page, not at an error.
 */
export async function openExtrasRequest(
  admin: AdminClient,
  opts: { studentId: string; now?: Date }
): Promise<PaymentRequestRow> {
  const existing = await loadOpenExtrasRequest(admin, opts.studentId);
  if (existing) return existing;

  const { data: selections, error: sErr } = await admin
    .from("student_optional_selections")
    .select("*")
    .eq("student_id", opts.studentId)
    .eq("status", "selected")
    .is("payment_request_id", null);
  if (sErr) throw new WorkflowError(sErr.message, "database");
  const chosen = (selections ?? []) as StudentOptionalSelectionRow[];
  if (chosen.length === 0) throw new WorkflowError("There is nothing outstanding to pay for.", "status_conflict");

  const { data: items, error: iErr } = await admin
    .from("optional_items")
    .select("id, code, label, order_by")
    .in(
      "id",
      chosen.map((s) => s.item_id)
    );
  if (iErr) throw new WorkflowError(iErr.message, "database");

  const basket = outstandingTotal(chosen as unknown as SelectionLike[]);
  if (!basket.currency) {
    // Cannot happen while every line follows its campus's currency, and worth
    // saying out loud rather than charging a number that is wrong in both.
    throw new WorkflowError("This order mixes two currencies, so it cannot be paid for in one go. Call the office.", "status_conflict");
  }
  if (basket.totalMinor <= 0) throw new WorkflowError("There is nothing outstanding to pay for.", "status_conflict");

  const now = opts.now ?? new Date();
  const orderBy = earliestOrderBy(items ?? []);
  const dueAt = orderBy ? new Date(`${orderBy}T23:59:59+02:00`) : new Date(now.getTime() + FOURTEEN_DAYS);

  const { data: request, error } = await admin
    .from("payment_requests")
    .insert({
      ...subjectColumns({ kind: "extras", studentId: opts.studentId }),
      currency: basket.currency as "BWP" | "ZAR",
      amount_minor: basket.totalMinor,
      lines: orderLines(chosen as unknown as SelectionLike[], (items ?? []) as LabelledItem[]) as unknown as Json,
      due_at: dueAt.toISOString(),
    })
    .select("*")
    .single();
  if (error || !request) throw new WorkflowError(error?.message ?? "extras payment request insert failed", "database");

  // Name the lines this request covers, so a line chosen a minute later is not
  // silently settled by a payment that never included it.
  const { error: stampErr } = await admin
    .from("student_optional_selections")
    .update({ payment_request_id: request.id })
    .in(
      "id",
      chosen.map((s) => s.id)
    )
    .is("payment_request_id", null);
  if (stampErr) throw new WorkflowError(stampErr.message, "database");

  return request;
}
