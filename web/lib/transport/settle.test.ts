import { describe, expect, it } from "vitest";
import type { AdminClient } from "@/lib/supabase/admin";
import type { PaymentRequestRow, PaymentRow } from "@/lib/supabase/types";
import { onTransportPaid, onTransportPaymentFailed } from "@/lib/transport/settle";

/**
 * What a transport payment does to its request, its booking, the tasks and
 * the job queue, against a recording double of the client. Every chain is
 * awaitable; each write is recorded with its table, values and filters, and
 * each read is answered from `answers`.
 */
type Call = { table: string; op: string; values?: unknown; filters: unknown[][] };

function stub(answers: { settled?: boolean; bookingStatus?: string } = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", filters: [] };
    calls.push(call);
    const result = () => {
      if (table === "payments" && call.op === "update") {
        return { data: answers.settled === false ? [] : [{ id: "p1" }], error: null };
      }
      if (table === "transport_bookings" && call.op === "select") {
        return { data: { reference: "HTR-2027-00042", status: answers.bookingStatus ?? "awaiting_payment" }, error: null };
      }
      if (table === "tasks" && call.op === "select") return { data: null, count: 0, error: null };
      if (table === "jobs") return { data: [{ id: "j1" }], error: null };
      return { data: null, error: null };
    };
    const q: Record<string, unknown> = {};
    const chain = (name: string) => (...args: unknown[]) => {
      if (name === "update" || name === "insert" || name === "upsert") {
        call.op = name;
        call.values = args[0];
      } else if (name !== "select") {
        call.filters.push([name, ...args]);
      }
      return q;
    };
    for (const name of ["select", "update", "insert", "upsert", "eq", "neq", "in"]) q[name] = chain(name);
    q.single = async () => result();
    q.maybeSingle = async () => result();
    q.then = (resolve: (v: unknown) => void) => resolve(result());
    return q;
  };
  return { admin: { from } as unknown as AdminClient, calls };
}

const request = (over: Partial<PaymentRequestRow> = {}): PaymentRequestRow =>
  ({
    id: "r1",
    transport_booking_id: "tb1",
    application_id: null,
    offer_id: null,
    acceptance_id: null,
    student_id: null,
    kind: "transport",
    campus_id: "c1",
    currency: "BWP",
    amount_minor: 1290000,
    lines: [],
    paid_minor: 0,
    status: "required",
    due_at: "2027-01-10T00:00:00Z",
    paid_at: null,
    created_at: "",
    updated_at: "",
    ...over,
  }) as PaymentRequestRow;

const payment = (over: Partial<PaymentRow> = {}): PaymentRow =>
  ({ id: "p1", amount_minor: 1290000, currency: "BWP", status: "processing", ...over }) as PaymentRow;

const writes = (calls: Call[], table: string) => calls.filter((c) => c.table === table && c.op !== "select");

describe("onTransportPaid", () => {
  it("marks the request and then the booking paid, and queues the receipt email once", async () => {
    const { admin, calls } = stub();
    await onTransportPaid(admin, request(), payment(), { approvalCode: "A1" });
    expect(writes(calls, "payment_requests")[0].values).toMatchObject({ status: "paid", paid_minor: 1290000 });
    expect(writes(calls, "transport_bookings")[0].values).toEqual({ status: "paid" });
    const job = writes(calls, "jobs")[0].values as Array<Record<string, unknown>>;
    expect(job[0]).toMatchObject({ type: "send_transport_email", idempotency_key: "transport_paid:p1" });
    expect(writes(calls, "tasks")).toHaveLength(0);
    // The request is marked paid before the booking: the database refuses a
    // paid booking whose request is not.
    const order = calls.filter((c) => c.op === "update").map((c) => c.table);
    expect(order.indexOf("payment_requests")).toBeLessThan(order.indexOf("transport_bookings"));
  });

  it("does nothing the second time the same payment is confirmed", async () => {
    const { admin, calls } = stub({ settled: false });
    await onTransportPaid(admin, request(), payment(), { approvalCode: "A1" });
    expect(calls.filter((c) => c.op !== "select" && c.table !== "payments")).toHaveLength(0);
  });

  it("settles a booking that expired while the parent was still paying", async () => {
    const { admin, calls } = stub({ bookingStatus: "expired" });
    await onTransportPaid(admin, request(), payment(), { approvalCode: "A1" });
    expect(writes(calls, "transport_bookings")[0].values).toEqual({ status: "paid" });
  });

  it("leaves a part payment unpaid, with a task naming the reference and not a child", async () => {
    const { admin, calls } = stub();
    await onTransportPaid(admin, request(), payment({ amount_minor: 1000000 }), { approvalCode: null });
    expect(writes(calls, "payment_requests")[0].values).toMatchObject({ status: "partially_paid" });
    expect(writes(calls, "transport_bookings")).toHaveLength(0);
    const task = writes(calls, "tasks")[0].values as Record<string, unknown>;
    expect(task).toMatchObject({ type: "transport_shortfall", transport_booking_id: "tb1", campus_id: "c1" });
    expect(String(task.title)).toContain("HTR-2027-00042");
  });

  it("asks a person about money for a cancelled booking, and does not revive it", async () => {
    const { admin, calls } = stub({ bookingStatus: "cancelled" });
    await onTransportPaid(admin, request(), payment(), { approvalCode: "A1" });
    expect(writes(calls, "transport_bookings")).toHaveLength(0);
    expect(writes(calls, "tasks")[0].values).toMatchObject({ type: "transport_late_payment", priority: "high" });
    expect(writes(calls, "jobs")).toHaveLength(0);
  });

  it("asks a person about a second payment on a request already paid", async () => {
    const { admin, calls } = stub();
    await onTransportPaid(admin, request({ status: "paid", paid_minor: 1290000 }), payment({ id: "p2" }), { approvalCode: "A2" });
    expect(writes(calls, "tasks")[0].values).toMatchObject({ type: "transport_double_payment", priority: "high" });
    expect(writes(calls, "jobs")).toHaveLength(0);
  });
});

describe("onTransportPaymentFailed", () => {
  it("keeps the request open as failed, so the parent can pay again", async () => {
    const { admin, calls } = stub();
    await onTransportPaymentFailed(admin, request(), payment(), "declined");
    expect(writes(calls, "payments")[0].values).toEqual({ status: "failed", failure_reason: "declined" });
    expect(writes(calls, "payment_requests")[0].values).toEqual({ status: "failed" });
    expect(writes(calls, "tasks")).toHaveLength(0);
  });

  it("raises a task when the gateway's amount does not match", async () => {
    const { admin, calls } = stub();
    await onTransportPaymentFailed(admin, request(), payment(), "amount_mismatch: provider says 1 BWP", { review: true });
    expect(writes(calls, "tasks")[0].values).toMatchObject({ type: "transport_payment_review", transport_booking_id: "tb1" });
  });
});
