import { describe, expect, it } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";
import type { OfferStatus } from "@/lib/supabase/types";
import { SYSTEM_ACTOR, WorkflowError } from "@/lib/workflow/engine";
import { onOfferDeadlineMoved, onPaymentDeadlineMoved } from "@/lib/workflow/deadline-actions";
import { letterInPlay } from "@/lib/workflow/reprice-actions";

/**
 * Moving a family's deadline (the school's request of 22 October 2026: every
 * scholarship deadline to 5 December, lapsed offers included) and the rule
 * the starting month and campus moves share for re-pricing a written letter.
 *
 * A Supabase double in the shape of `stage-move-actions.test.ts`'s: every
 * query resolves to the rows given for its table, writes are logged, and the
 * commit's arguments are kept so a test can read what it asked for.
 */
function stub(rows: Record<string, unknown>, opts: { refuseCommit?: boolean } = {}) {
  const log: string[] = [];
  const commits: Array<Record<string, unknown>> = [];
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const from = (table: string): unknown => {
    const q: unknown = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === "then") return (resolve: (value: unknown) => void) => resolve({ data: rows[table] ?? [], error: null });
          return (...args: unknown[]) => {
            if (prop === "update") {
              log.push(`write:${table}`);
              updates.push({ table, values: args[0] as Record<string, unknown> });
            }
            return q;
          };
        },
      }
    );
    return q;
  };
  const admin = {
    from,
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      commits.push(args);
      log.push(`commit:${(args.p_new_status as string | null) ?? "event"}`);
      return opts.refuseCommit ? { data: null, error: { message: "status_conflict: expected offer_expired, found withdrawn" } } : { data: 1, error: null };
    },
  } as unknown as AdminClient;
  return { admin, log, commits, updates };
}

const decemberFifth = new Date("2026-12-05T21:59:59Z");
const template = { id: "t-1", body_html: "<p>Open until {{offer_expiry_date}}.</p>", terms_html: "", allowed_variables: ["offer_expiry_date"] };
const offer = (status: OfferStatus) => ({
  id: "offer-1",
  status,
  expires_at: "2026-10-12T08:00:00Z",
  template_id: "t-1",
  variables: { offer_expiry_date: "12 October 2026" },
  first_viewed_at: "2026-10-01T09:00:00Z",
  fees: { currency: "ZAR", lines: [{ code: "registration", label: "2026/2027 admission fee", amount_minor: 120_000 }] },
  rendered_html: "<p>Open until 12 October 2026.</p>",
  terms_html: "",
});

describe("letterInPlay", () => {
  it("re-drafts a letter waiting for approval in place", async () => {
    const { admin } = stub({ offers: { id: "o", status: "pending_approval", conditions: null } });
    expect(await letterInPlay(admin, { id: "a", status: "offer_pending_approval" })).toMatchObject({ reDraft: true, withFamily: false });
  });

  it("withdraws and re-drafts one the family has, opened or lapsed", async () => {
    for (const [status, appStatus] of [["viewed", "offer_sent"], ["expired", "offer_expired"]] as const) {
      const { admin } = stub({ offers: { id: "o", status, conditions: null } });
      expect(await letterInPlay(admin, { id: "a", status: appStatus })).toMatchObject({ reDraft: true, withFamily: true });
    }
  });

  it("leaves a draft waiting for fees to Generate offer", async () => {
    const { admin } = stub({ offers: { id: "o", status: "draft", conditions: null } });
    expect(await letterInPlay(admin, { id: "a", status: "offer_draft" })).toMatchObject({ reDraft: false, withFamily: false });
  });
});

describe("onOfferDeadlineMoved", () => {
  it("reopens a lapsed offer as it was, and closes the follow-up task", async () => {
    const { admin, log, commits } = stub({ offer_templates: template, offers: [{ id: "offer-1" }], jobs: [], settings: [] });
    const out = await onOfferDeadlineMoved(admin, { id: "app-1", status: "offer_expired" }, offer("expired"), decemberFifth, "school's instruction", SYSTEM_ACTOR, { notify: true });
    expect(out).toEqual({ reopened: true });
    expect(log).toEqual(["write:offers", "commit:offer_sent"]);
    expect(commits[0].p_resolve_task_types).toEqual(["follow_up_expired_offer"]);
    const jobs = commits[0].p_jobs as Array<{ type: string; idempotency_key: string; payload: { template_key?: string; variables?: Record<string, string | null> } }>;
    // A new sweep for the new date, keyed per move so the outbox treats it as
    // new even when an earlier move used the same date.
    expect(jobs.find((j) => j.type === "offer_expire")?.idempotency_key).toMatch(/^offer_expire:offer-1:2026-12-05:\d+$/);
    // The family is told, with the date in their own words.
    const email = jobs.find((j) => j.payload.template_key === "deadline_moved");
    expect(email?.payload.variables).toMatchObject({ offer_open: "yes", fees_due: null });
    expect(email?.payload.variables?.new_deadline).toContain("December 2026");
  });

  it("names the application fee on a letter frozen before the label existed", async () => {
    const { admin, updates } = stub({
      offer_templates: { ...template, body_html: "<p>{{registration_fee_label}}: open until {{offer_expiry_date}}.</p>", allowed_variables: ["offer_expiry_date", "registration_fee_label"] },
      offers: [{ id: "offer-1" }],
      jobs: [],
      settings: [],
    });
    await onOfferDeadlineMoved(admin, { id: "app-1", status: "offer_sent" }, offer("viewed"), decemberFifth, "r", SYSTEM_ACTOR);
    const written = updates.find((u) => u.table === "offers")?.values;
    expect(written?.rendered_html).toContain("2026/2027 admission fee: open until");
  });

  it("moves an open offer's date without touching its status", async () => {
    const { admin, log } = stub({ offer_templates: template, offers: [{ id: "offer-1" }], jobs: [], settings: [] });
    expect(await onOfferDeadlineMoved(admin, { id: "app-1", status: "offer_sent" }, offer("viewed"), decemberFifth, "r", SYSTEM_ACTOR)).toEqual({ reopened: false });
    // The current status again, which moves the application's own due date with it.
    expect(log).toEqual(["write:offers", "commit:offer_sent"]);
  });

  it("puts the offer back when the application refuses the move", async () => {
    // A stage moved in the same second: the commit says no. Left as written,
    // the offer would be open under an application still marked expired, and
    // could neither be moved again nor answered.
    const { admin, log, updates } = stub({ offer_templates: template, offers: [{ id: "offer-1" }], jobs: [], settings: [] }, { refuseCommit: true });
    await expect(onOfferDeadlineMoved(admin, { id: "app-1", status: "offer_expired" }, offer("expired"), decemberFifth, "r", SYSTEM_ACTOR)).rejects.toThrow(/status_conflict/);
    expect(log).toEqual(["write:offers", "commit:offer_sent", "write:offers"]);
    expect(updates[1].values).toMatchObject({ status: "expired", expires_at: "2026-10-12T08:00:00Z", rendered_html: "<p>Open until 12 October 2026.</p>" });
  });

  it("refuses an offer already answered, and a date already gone", async () => {
    const { admin, log } = stub({});
    await expect(onOfferDeadlineMoved(admin, { id: "app-1", status: "offer_accepted" }, offer("accepted"), decemberFifth, "r", SYSTEM_ACTOR)).rejects.toThrow(WorkflowError);
    await expect(onOfferDeadlineMoved(admin, { id: "app-1", status: "offer_sent" }, offer("sent"), new Date("2020-01-01"), "r", SYSTEM_ACTOR)).rejects.toThrow(/future/);
    expect(log).toEqual([]);
  });
});

describe("onPaymentDeadlineMoved", () => {
  const app = { id: "app-1", status: "payment_required" as const, next_action: "pay_fees", next_action_due_at: "2026-10-16T21:59:59Z" };

  it("answers the overdue task and queues a new sweep when a passed date moves forward", async () => {
    const { admin, commits } = stub({ payment_requests: [{ id: "req-1" }], jobs: [], settings: [] });
    await onPaymentDeadlineMoved(admin, app, { id: "req-1", due_at: "2026-10-16T21:59:59Z" }, decemberFifth, "r", SYSTEM_ACTOR, { notify: true });
    expect(commits[0].p_resolve_task_types).toEqual(["payment_overdue"]);
    const jobs = commits[0].p_jobs as Array<{ type: string; idempotency_key: string; payload: { template_key?: string } }>;
    expect(jobs.find((j) => j.type === "payment_overdue")?.idempotency_key).toMatch(/^payment_overdue:req-1:2026-12-05:\d+$/);
    expect(jobs.some((j) => j.payload.template_key === "deadline_moved")).toBe(true);
  });

  it("puts the date and the application's due date back when the move is refused", async () => {
    const { admin, updates } = stub({ payment_requests: [{ id: "req-1" }], jobs: [], settings: [] }, { refuseCommit: true });
    await expect(onPaymentDeadlineMoved(admin, app, { id: "req-1", due_at: "2026-10-16T21:59:59Z" }, decemberFifth, "r", SYSTEM_ACTOR)).rejects.toThrow(/status_conflict/);
    const last = (table: string) => updates.filter((u) => u.table === table).at(-1)?.values;
    expect(last("payment_requests")).toEqual({ due_at: "2026-10-16T21:59:59Z" });
    expect(last("applications")).toEqual({ next_action_due_at: "2026-10-16T21:59:59Z" });
  });

  it("refuses a request that is no longer open", async () => {
    const { admin } = stub({ payment_requests: [] });
    await expect(onPaymentDeadlineMoved(admin, app, { id: "req-1", due_at: "2026-10-16T21:59:59Z" }, decemberFifth, "r", SYSTEM_ACTOR)).rejects.toThrow(/no longer open/);
  });

  it("does nothing when the date is unchanged", async () => {
    const { admin, log } = stub({});
    expect(await onPaymentDeadlineMoved(admin, app, { id: "req-1", due_at: decemberFifth.toISOString() }, decemberFifth, "r", SYSTEM_ACTOR)).toEqual({ moved: false });
    expect(log).toEqual([]);
  });
});
