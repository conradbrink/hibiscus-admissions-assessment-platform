import Link from "next/link";
import { notFound } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowDownToLine, CircleCheck, Plus } from "lucide-react";
import { PageTitle } from "@/components/staff/page-title";
import { ConditionBadge, DueBadge } from "@/components/stores/badges";
import { SignatureCard } from "@/components/stores/signature-card";
import { ReturnAssetForm, ReverseForm } from "@/components/stores/transaction-forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { formatDate, formatDateLong, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { acknowledgements } from "@/lib/stores/data";
import { TRANSACTION_KINDS, transactionHref, type TransactionKind } from "@/lib/stores/links";
import { ADJUSTMENT_LABELS, quantityLine } from "@/lib/stores/rules";
import { schoolToday } from "@/lib/stores/server";
import type { Database } from "@/lib/supabase/types";
import { isUuid } from "@/lib/uuid";
import { cn } from "@/lib/utils";

export const metadata = { title: "Transaction" };

type Client = SupabaseClient<Database>;
type Ctx = { supabase: Client; writer: boolean; admin: boolean; today: string; soonDays: number; done: boolean };

const TITLES: Record<TransactionKind, string> = {
  receipt: "Stock received",
  checkout: "Equipment checked out",
  return: "Equipment returned",
  issue: "Consumables issued",
  assignment: "Asset assigned",
  adjustment: "Stock adjustment",
};

/**
 * One transaction, exactly as it was recorded: who, what, when, by whom, and
 * the employee's signature where there is one. Nothing here edits the
 * record. An administrator may reverse it, which adds a reversal beside it.
 */
export default async function TransactionPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ done?: string }> }) {
  const [{ kind, id }, sp] = await Promise.all([params, searchParams]);
  if (!TRANSACTION_KINDS.includes(kind as TransactionKind) || !isUuid(id)) notFound();
  const { supabase, permissions } = await requireStaff("stores.read");
  const ack = await acknowledgements(supabase);
  const ctx: Ctx = { supabase, writer: can(permissions, "stores.write"), admin: can(permissions, "stores.admin"), today: schoolToday(), soonDays: ack.dueSoonDays, done: sp.done === "1" };
  switch (kind as TransactionKind) {
    case "checkout":
      return <Checkout id={id} ctx={ctx} />;
    case "return":
      return <Return id={id} ctx={ctx} />;
    case "receipt":
      return <Receipt id={id} ctx={ctx} />;
    case "issue":
      return <Issue id={id} ctx={ctx} />;
    case "assignment":
      return <Assignment id={id} ctx={ctx} />;
    case "adjustment":
      return <Adjustment id={id} />;
  }
}

function Facts({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="surface grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
          <dd className="mt-0.5 text-foreground">{value ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

function Done({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-2xl border border-success/30 bg-success/10 p-4 sm:p-5" role="status">
      <div className="flex items-start gap-3">
        <CircleCheck className="mt-0.5 size-6 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-foreground">{title}</p>
          {children ? <div className="mt-3 flex flex-col gap-2 sm:flex-row">{children}</div> : null}
        </div>
      </div>
    </div>
  );
}

function Reversed({ reversal }: { reversal: { reference: string; reason: string; recorded_at: string; recorded_by_name: string } | null }) {
  if (!reversal) return null;
  return (
    <p className="mb-5 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm" role="note">
      <span className="font-semibold text-destructive">Reversed as {reversal.reference}</span> on {formatDateTime(reversal.recorded_at)} by {reversal.recorded_by_name}. Reason: {reversal.reason}
    </p>
  );
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
const big = "h-12 text-base sm:h-9 sm:text-sm";

async function Checkout({ id, ctx }: { id: string; ctx: Ctx }) {
  const [{ data: co }, { data: lines }, { data: sigs }, { data: returns }] = await Promise.all([
    ctx.supabase.from("stores_checkouts").select("*, stores_reversals(reference, reason, recorded_at, recorded_by_name)").eq("id", id).maybeSingle(),
    ctx.supabase.from("stores_checkout_lines").select("*").eq("checkout_id", id).order("item_name"),
    ctx.supabase.from("stores_signatures").select("*").eq("checkout_id", id).eq("kind", "checkout"),
    ctx.supabase.from("stores_returns").select("id, reference, returned_at, recorded_by_name, reversal_id, stores_return_lines(item_name, quantity, unit, condition)").eq("checkout_id", id).order("returned_at"),
  ]);
  if (!co) notFound();
  const outstanding = (lines ?? []).reduce((n, l) => n + l.quantity_outstanding, 0);
  const sig = sigs?.[0];
  const statusBadge = co.status === "reversed" ? <Badge variant="destructive">Reversed</Badge> : co.status === "completed" ? <Badge variant="success">Completed</Badge> : <DueBadge expected={co.expected_return_date} today={ctx.today} soonDays={ctx.soonDays} />;
  return (
    <>
      <PageTitle title={`${TITLES.checkout} · ${co.reference}`} description={`${co.employee_name}${co.department_name ? `, ${co.department_name}` : ""}`} back={{ href: "/staff/stores/movements", label: "Stock movements" }} />
      {ctx.done ? (
        <Done title={`Checkout ${co.reference} recorded and signed for.`}>
          <Link href="/staff/stores/check-out" className={cn(buttonVariants(), big)}><Plus aria-hidden /> New checkout</Link>
          <Link href="/staff/stores" className={cn(buttonVariants({ variant: "outline" }), big)}>Back to the dashboard</Link>
        </Done>
      ) : null}
      <Reversed reversal={one(co.stores_reversals)} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {statusBadge}
        {co.status === "open" && ctx.writer ? (
          <Link href={`/staff/stores/check-in/${co.id}`} className={cn(buttonVariants({ size: "lg" }), "ml-auto", big)}>
            <ArrowDownToLine aria-hidden /> Return items
          </Link>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Facts
            items={[
              ["Employee", co.employee_name],
              ["Department", co.department_name],
              ["Checked out", formatDateTime(co.checked_out_at)],
              ["Expected return", formatDateLong(co.expected_return_date)],
              ["Recorded by", co.recorded_by_name],
              ["Completed", co.completed_at && co.status === "completed" ? formatDateTime(co.completed_at) : null],
              ...(co.notes ? ([["Note", co.notes]] as Array<[string, React.ReactNode]>) : []),
            ]}
          />
          <section className="surface overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Equipment</th><th className="text-right">Issued</th><th className="text-right">Returned</th><th className="text-right">Written off</th><th className="text-right">Outstanding</th></tr></thead>
              <tbody>
                {(lines ?? []).map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/staff/stores/inventory/${l.item_id}`} className="font-medium hover:underline">{l.item_name}</Link></td>
                    <td className="text-right tabular-nums">{l.quantity}</td>
                    <td className="text-right tabular-nums">{l.quantity_returned}</td>
                    <td className="text-right tabular-nums">{l.quantity_written_off || <span className="text-muted-foreground">0</span>}</td>
                    <td className={cn("text-right font-semibold tabular-nums", l.quantity_outstanding > 0 && "text-foreground")}>{l.quantity_outstanding}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">{outstanding > 0 ? `${outstanding} still to come back.` : "Everything is accounted for."}</p>
          </section>
          {returns && returns.length ? (
            <section className="surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Returns</h2>
              <ul className="space-y-2 text-sm">
                {returns.map((r) => (
                  <li key={r.id} className="relative -mx-2 rounded-lg px-2 py-1.5 has-[a:hover]:bg-muted/40">
                    <Link href={transactionHref("return", r.id)} className="font-medium text-primary after:absolute after:inset-0 hover:underline">{r.reference}</Link>
                    <span className="text-muted-foreground"> · {formatDateTime(r.returned_at)} · {r.recorded_by_name}</span>
                    {r.reversal_id ? <Badge variant="destructive" className="ml-2">Reversed</Badge> : null}
                    <span className="block text-xs text-muted-foreground">{r.stores_return_lines.map((l) => `${quantityLine(l.quantity, l.item_name, l.unit)} (${l.condition.replace("_", " ")})`).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {/* The database's own rule: nothing on it has come back (net of
              reversed returns) or been written off. Counting return records
              hid the button for good once a return was reversed. */}
          {ctx.admin && co.status === "open" && !co.reversal_id && (lines ?? []).every((l) => l.quantity_returned === 0 && l.quantity_written_off === 0) ? (
            <section className="surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Correct this checkout</h2>
              <ReverseForm kind="checkout" id={co.id} reference={co.reference} consequence="The equipment goes back on the shelf. The signature and this record stay as they are, marked as reversed." />
            </section>
          ) : null}
        </div>
        <div>{sig ? <SignatureCard title="Handover signature" signature={sig} /> : <p className="surface p-4 text-sm text-destructive">No signature is stored for this checkout.</p>}</div>
      </div>
    </>
  );
}

async function Return({ id, ctx }: { id: string; ctx: Ctx }) {
  const [{ data: r }, { data: lines }, { data: sigs }] = await Promise.all([
    ctx.supabase.from("stores_returns").select("*, stores_checkouts!stores_returns_checkout_id_fkey(id, reference, status), stores_reversals(reference, reason, recorded_at, recorded_by_name)").eq("id", id).maybeSingle(),
    ctx.supabase.from("stores_return_lines").select("*").eq("return_id", id).order("item_name"),
    ctx.supabase.from("stores_signatures").select("*").eq("return_id", id),
  ]);
  if (!r) notFound();
  const co = one(r.stores_checkouts);
  const { data: later } = await ctx.supabase.from("stores_returns").select("id").eq("checkout_id", r.checkout_id).is("reversal_id", null).gt("returned_at", r.returned_at).limit(1);
  const { data: left } = await ctx.supabase.from("stores_checkout_lines").select("item_name, quantity_outstanding, unit").eq("checkout_id", r.checkout_id).gt("quantity_outstanding", 0);
  return (
    <>
      <PageTitle title={`${TITLES.return} · ${r.reference}`} description={r.employee_name} back={{ href: co ? transactionHref("checkout", co.id) : "/staff/stores/movements", label: co ? `Checkout ${co.reference}` : "Stock movements" }} />
      {ctx.done ? (
        <Done title={left && left.length ? `Return ${r.reference} recorded. Still outstanding: ${left.map((l) => quantityLine(l.quantity_outstanding, l.item_name, l.unit)).join(", ")}.` : `Return ${r.reference} recorded. Checkout ${co?.reference ?? ""} is complete.`}>
          <Link href="/staff/stores/check-in" className={cn(buttonVariants(), big)}>Back to Check In</Link>
          <Link href="/staff/stores" className={cn(buttonVariants({ variant: "outline" }), big)}>Back to the dashboard</Link>
        </Done>
      ) : null}
      <Reversed reversal={one(r.stores_reversals)} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Facts
            items={[
              ["Employee", r.employee_name],
              ["Checkout", co ? <Link key="co" href={transactionHref("checkout", co.id)} className="font-medium text-primary hover:underline">{co.reference}</Link> : null],
              ["Returned", formatDateTime(r.returned_at)],
              ["Recorded by", r.recorded_by_name],
              ...(r.notes ? ([["Note", r.notes]] as Array<[string, React.ReactNode]>) : []),
            ]}
          />
          <section className="surface overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Equipment</th><th className="text-right">Returned</th><th>Condition</th><th>Note</th></tr></thead>
              <tbody>
                {(lines ?? []).map((l) => (
                  <tr key={l.id}>
                    <td><Link href={`/staff/stores/inventory/${l.item_id}`} className="font-medium hover:underline">{l.item_name}</Link></td>
                    <td className="text-right tabular-nums">{l.quantity}</td>
                    <td><ConditionBadge condition={l.condition} /></td>
                    <td className="text-muted-foreground">{l.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {ctx.admin && !r.reversal_id && !(later && later.length) ? (
            <section className="surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Correct this return</h2>
              <ReverseForm kind="return" id={r.id} reference={r.reference} consequence="The items count as on loan again and the checkout reopens. The signature and this record stay as they are, marked as reversed." />
            </section>
          ) : null}
        </div>
        <div>{sigs?.[0] ? <SignatureCard title="Return signature" signature={sigs[0]} /> : <p className="surface p-4 text-sm text-destructive">No signature is stored for this return.</p>}</div>
      </div>
    </>
  );
}

async function Receipt({ id, ctx }: { id: string; ctx: Ctx }) {
  const { data: r } = await ctx.supabase.from("stores_receipts").select("*, stores_items!stores_receipts_item_id_fkey(unit), stores_reversals(reference, reason, recorded_at, recorded_by_name)").eq("id", id).maybeSingle();
  if (!r) notFound();
  const unit = one(r.stores_items)?.unit ?? "each";
  return (
    <>
      <PageTitle title={`${TITLES.receipt} · ${r.reference}`} description={r.is_opening ? `${r.item_name}: opening stock` : r.item_name} back={{ href: `/staff/stores/inventory/${r.item_id}`, label: r.item_name }} />
      <Reversed reversal={one(r.stores_reversals)} />
      <div className="max-w-2xl space-y-4">
        <Facts
          items={[
            ["Item", <Link key="i" href={`/staff/stores/inventory/${r.item_id}`} className="font-medium text-primary hover:underline">{r.item_name}</Link>],
            ["Quantity", `${r.quantity} ${unit}`],
            ["Date received", formatDate(r.received_on)],
            ["Supplier", r.supplier],
            ["Price each", r.unit_price_minor !== null ? formatMoney(r.unit_price_minor, "BWP") : null],
            ["Invoice or delivery note", r.invoice_ref],
            ["Recorded", `${formatDateTime(r.recorded_at)} by ${r.recorded_by_name}`],
            ...(r.notes ? ([["Note", r.notes]] as Array<[string, React.ReactNode]>) : []),
          ]}
        />
        {ctx.admin && !r.reversal_id && r.quantity > 0 ? (
          <section className="surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Correct this receipt</h2>
            <ReverseForm kind="receipt" id={r.id} reference={r.reference} consequence="The quantity comes off the shelf again. Only possible while that much is still on the shelf." />
          </section>
        ) : null}
      </div>
    </>
  );
}

async function Issue({ id, ctx }: { id: string; ctx: Ctx }) {
  const [{ data: is }, { data: lines }] = await Promise.all([
    ctx.supabase.from("stores_issues").select("*, stores_reversals(reference, reason, recorded_at, recorded_by_name)").eq("id", id).maybeSingle(),
    ctx.supabase.from("stores_issue_lines").select("*").eq("issue_id", id).order("item_name"),
  ]);
  if (!is) notFound();
  return (
    <>
      <PageTitle title={`${TITLES.issue} · ${is.reference}`} description={`${is.employee_name}${is.department_name ? `, ${is.department_name}` : ""}`} back={{ href: "/staff/stores/movements", label: "Stock movements" }} />
      {ctx.done ? (
        <Done title={`Issue ${is.reference} recorded. The stock has been deducted.`}>
          <Link href="/staff/stores/issues" className={cn(buttonVariants(), big)}><Plus aria-hidden /> Issue more</Link>
          <Link href="/staff/stores" className={cn(buttonVariants({ variant: "outline" }), big)}>Back to the dashboard</Link>
        </Done>
      ) : null}
      <Reversed reversal={one(is.stores_reversals)} />
      <div className="max-w-2xl space-y-4">
        <Facts items={[["Received by", is.employee_name], ["Department", is.department_name], ["Issued", formatDateTime(is.issued_at)], ["Recorded by", is.recorded_by_name], ...(is.notes ? ([["Note", is.notes]] as Array<[string, React.ReactNode]>) : [])]} />
        <ul className="surface divide-y divide-border/70">
          {(lines ?? []).map((l) => (
            <li key={l.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <Link href={`/staff/stores/inventory/${l.item_id}`} className="font-medium hover:underline">{quantityLine(l.quantity, l.item_name, l.unit)}</Link>
            </li>
          ))}
        </ul>
        {ctx.admin && !is.reversal_id ? (
          <section className="surface p-4">
            <h2 className="mb-2 text-sm font-semibold">Correct this issue</h2>
            <ReverseForm kind="issue" id={is.id} reference={is.reference} consequence="The quantities go back on the shelf, as if they had not been issued." />
          </section>
        ) : null}
      </div>
    </>
  );
}

async function Assignment({ id, ctx }: { id: string; ctx: Ctx }) {
  const [{ data: a }, { data: back }] = await Promise.all([
    ctx.supabase.from("stores_assignments").select("*, stores_reversals(reference, reason, recorded_at, recorded_by_name)").eq("id", id).maybeSingle(),
    ctx.supabase.from("stores_asset_returns").select("*").eq("assignment_id", id).order("returned_at"),
  ]);
  if (!a) notFound();
  const status = a.status === "active" ? <Badge variant="info">Assigned</Badge> : a.status === "returned" ? <Badge variant="success">Back in the storeroom</Badge> : <Badge variant="destructive">Reversed</Badge>;
  return (
    <>
      {/* The assigned-assets list is a storekeeper's screen; somebody who may
          only read Stores goes back to the item instead of to a refusal. */}
      <PageTitle
        title={`${TITLES.assignment} · ${a.reference}`}
        description={`${a.item_name} to ${a.department_name}`}
        back={ctx.writer ? { href: "/staff/stores/issues/assigned", label: "Assigned assets" } : { href: `/staff/stores/inventory/${a.item_id}`, label: a.item_name }}
      />
      {ctx.done ? (
        <Done title={`Assignment ${a.reference} recorded. ${a.item_name} stays on the school's asset register.`}>
          <Link href="/staff/stores/issues/assign" className={cn(buttonVariants(), big)}><Plus aria-hidden /> Assign another</Link>
          <Link href="/staff/stores" className={cn(buttonVariants({ variant: "outline" }), big)}>Back to the dashboard</Link>
        </Done>
      ) : null}
      <Reversed reversal={one(a.stores_reversals)} />
      <div className="mb-4">{status}</div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Facts
            items={[
              ["Item", <Link key="i" href={`/staff/stores/inventory/${a.item_id}`} className="font-medium text-primary hover:underline">{a.item_name}</Link>],
              ["Quantity", `${a.quantity} assigned, ${a.quantity_held} still held`],
              ["Department", a.department_name],
              ["Responsible person", a.employee_name],
              ["Location", a.location_note],
              ["Assigned", `${formatDateTime(a.assigned_at)} by ${a.recorded_by_name}`],
              ...(a.notes ? ([["Note", a.notes]] as Array<[string, React.ReactNode]>) : []),
            ]}
          />
          {back && back.length ? (
            <section className="surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Returned to the storeroom</h2>
              <ul className="space-y-1.5 text-sm">
                {back.map((b) => (
                  <li key={b.id}>
                    <span className="font-medium">{b.reference}</span> · {b.quantity} · <ConditionBadge condition={b.condition} /> · {formatDateTime(b.returned_at)} · {b.recorded_by_name}
                    {b.notes ? <span className="block text-xs text-muted-foreground">{b.notes}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        <div className="space-y-4">
          {ctx.writer && a.status === "active" ? (
            <section className="surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Return to the storeroom</h2>
              <ReturnAssetForm assignmentId={a.id} held={a.quantity_held} unit={a.unit} />
            </section>
          ) : null}
          {ctx.admin && a.status === "active" && !(back && back.length) ? (
            <section className="surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Reverse the assignment</h2>
              <ReverseForm kind="assignment" id={a.id} reference={a.reference} consequence="For an assignment recorded by mistake: the item goes back on the shelf and the assignment is marked reversed." />
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

async function Adjustment({ id }: { id: string }) {
  const { supabase } = await requireStaff("stores.read");
  const { data: a } = await supabase.from("stores_adjustments").select("*").eq("id", id).maybeSingle();
  if (!a) notFound();
  const deltas = [
    a.available_delta ? `on the shelf ${a.available_delta > 0 ? "+" : "−"}${Math.abs(a.available_delta)}` : null,
    a.unavailable_delta ? `held back ${a.unavailable_delta > 0 ? "+" : "−"}${Math.abs(a.unavailable_delta)}` : null,
    a.checked_out_delta ? `on loan ${a.checked_out_delta > 0 ? "+" : "−"}${Math.abs(a.checked_out_delta)}` : null,
  ].filter(Boolean);
  return (
    <>
      <PageTitle title={`${TITLES.adjustment} · ${a.reference}`} description={`${ADJUSTMENT_LABELS[a.kind]}: ${a.item_name}`} back={{ href: `/staff/stores/inventory/${a.item_id}`, label: a.item_name }} />
      <div className="max-w-2xl">
        <Facts
          items={[
            ["Item", <Link key="i" href={`/staff/stores/inventory/${a.item_id}`} className="font-medium text-primary hover:underline">{a.item_name}</Link>],
            ["Kind", ADJUSTMENT_LABELS[a.kind]],
            ["Quantity", a.quantity],
            ["Effect", deltas.join(", ")],
            ["Reason", a.reason],
            ["Recorded", `${formatDateTime(a.recorded_at)} by ${a.recorded_by_name}`],
          ]}
        />
      </div>
    </>
  );
}
