import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { StatusBadge } from "@/components/staff/status-badge";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { feeSnapshotFrom } from "@/lib/offers/snapshot";
import { can } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import { approveOffer, generateOffer, sendOutcome, withdrawOffer } from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * Offers & outcomes: everything a person must approve or send before it
 * reaches a parent. Four lists, oldest first in each.
 */
export default async function OffersPage() {
  const { supabase, permissions } = await requireStaff("offers.read");
  const canApprove = can(permissions, "offers.approve");

  const { data: apps } = await supabase
    .from("applications")
    .select("id, reference, status, status_changed_at, child_first_name, child_last_name, requires_assessment, campuses(name), grades!applications_grade_id_fkey(name), intakes(label)")
    .in("status", ["offer_pending_approval", "offer_draft", "offer_sent", "offer_expired", "waitlisted", "declined"])
    .order("status_changed_at", { ascending: true });
  const ids = (apps ?? []).map((a) => a.id);
  const [{ data: offers }, { data: profiles }, { data: tasks }] = ids.length
    ? await Promise.all([
        supabase.from("offers").select("*").in("application_id", ids).in("status", ["draft", "pending_approval", "sent", "viewed", "expired"]),
        supabase.from("learning_profiles").select("application_id, narrative_source, validation_status, published_at").in("application_id", ids),
        supabase.from("tasks").select("application_id, type").in("application_id", ids).eq("status", "open").eq("type", "send_outcome"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const offerByApp = new Map((offers ?? []).map((o) => [o.application_id, o]));
  const profileByApp = new Map((profiles ?? []).map((p) => [p.application_id, p]));
  const outcomePending = new Set((tasks ?? []).map((t) => t.application_id));

  const toApprove = (apps ?? []).filter((a) => a.status === "offer_pending_approval");
  const blocked = (apps ?? []).filter((a) => a.status === "offer_draft");
  const outcomes = (apps ?? []).filter((a) => (a.status === "waitlisted" || a.status === "declined") && outcomePending.has(a.id));
  const sent = (apps ?? []).filter((a) => a.status === "offer_sent" || a.status === "offer_expired");

  const fees = (o: { fees: unknown } | undefined) => feeSnapshotFrom(o?.fees);

  type App = NonNullable<typeof apps>[number];
  const Head = ({ a }: { a: App }) => (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1">
        <Link href={`/staff/applications/${a.id}`} className="font-semibold hover:underline">{a.child_first_name} {a.child_last_name}</Link>
        <p className="text-xs text-muted-foreground">{one(a.grades)?.name} · {one(a.campuses)?.name} · {one(a.intakes)?.label} · {a.reference} · since {formatDateTime(a.status_changed_at)}</p>
      </div>
      <StatusBadge status={a.status} />
    </div>
  );

  return (
    <>
      <PageTitle title="Offers & outcomes" description="Nothing here reaches a parent until a person approves or sends it. The switches under Workflow settings can automate each list later." />

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Offers to approve ({toApprove.length})</h2>
        {toApprove.length ? (
          <div className="space-y-3">
            {toApprove.map((a) => {
              const o = offerByApp.get(a.id);
              const f = fees(o);
              const profile = profileByApp.get(a.id);
              const profileReady = !a.requires_assessment || !!profile?.published_at;
              return (
                <section key={a.id} className="rounded-xl border border-border bg-card p-4">
                  <Head a={a} />
                  <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Learning profile</p>
                      {a.requires_assessment ? (
                        profile?.published_at ? (
                          <p className="mt-1">Ready · {profile.narrative_source === "ai" ? "AI narrative, validated" : "standard wording"}{profile.validation_status === "failed" ? " (AI text failed validation)" : ""}</p>
                        ) : (
                          <p className="mt-1 text-warning-foreground">Not generated yet. Approval waits for it.</p>
                        )
                      ) : (
                        <p className="mt-1 text-muted-foreground">Pre-school: no assessment, no profile.</p>
                      )}
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase">Fees ({f?.currency ?? o?.currency})</p>
                      {f ? (
                        <ul className="mt-1">
                          {f.lines.map((l) => <li key={l.code} className="flex justify-between"><span>{l.label}{l.payable_at_acceptance ? " *" : ""}</span><span className="tabular-nums">{formatMoney(l.amount_minor, f.currency)}</span></li>)}
                          <li className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>Payable on acceptance</span><span className="tabular-nums">{formatMoney(f.payable_at_acceptance_minor, f.currency)}</span></li>
                        </ul>
                      ) : <p className="mt-1 text-warning-foreground">No fees on this offer.</p>}
                    </div>
                  </div>
                  {o ? (
                    <details className="mt-3 text-sm">
                      <summary className="cursor-pointer text-primary">Preview the offer as the parent will read it</summary>
                      <div className="prose prose-sm mt-2 max-w-none rounded-lg border border-border bg-background p-4" dangerouslySetInnerHTML={{ __html: o.rendered_html + o.terms_html }} />
                    </details>
                  ) : null}
                  {canApprove && o ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <ActionForm action={approveOffer} label={profileReady ? "Approve & send" : "Waiting for profile"} size="sm" variant="success" confirm="Send this offer to the parent now?">
                        <input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="offerId" value={o.id} />
                      </ActionForm>
                      <ActionForm action={withdrawOffer} label="Withdraw" size="sm" variant="ghost" className="flex items-center gap-2">
                        <input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="offerId" value={o.id} />
                        <Input name="reason" placeholder="Why" className="h-8 w-48 md:h-8" required />
                      </ActionForm>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : <EmptyState>Nothing waiting for approval.</EmptyState>}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Offers that cannot be sent yet ({blocked.length})</h2>
        <p className="mb-2 text-xs text-muted-foreground">Approved, but no active fee schedule covers the campus, grade and year. Configure fees, then generate again.</p>
        {blocked.length ? (
          <div className="space-y-3">
            {blocked.map((a) => (
              <section key={a.id} className="rounded-xl border border-warning bg-card p-4">
                <Head a={a} />
                {canApprove ? (
                  <ActionForm action={generateOffer} label="Generate offer" size="sm" className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="applicationId" value={a.id} />
                    <Input name="conditions" placeholder="Conditions (optional)" className="h-8 w-72 md:h-8" />
                  </ActionForm>
                ) : null}
              </section>
            ))}
          </div>
        ) : <EmptyState>None.</EmptyState>}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold">Outcomes to send ({outcomes.length})</h2>
        {outcomes.length ? (
          <div className="space-y-3">
            {outcomes.map((a) => {
              const profile = profileByApp.get(a.id);
              return (
                <section key={a.id} className="rounded-xl border border-border bg-card p-4">
                  <Head a={a} />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {a.status === "waitlisted" ? "Waitlist email" : "Decline email"}{a.requires_assessment ? (profile?.published_at ? ", with the learning profile link" : " — the learning profile is not ready yet; the email will go without it") : ""}.
                    {" "}<Link href={`/staff/admin/templates/${a.status === "waitlisted" ? "outcome_waitlisted" : "outcome_declined"}`} className="text-primary underline underline-offset-2">Check the wording</Link>.
                  </p>
                  {canApprove ? (
                    <ActionForm action={sendOutcome} label="Send" size="sm" variant="success" className="mt-3" confirm="Send this outcome email to the parent now?">
                      <input type="hidden" name="applicationId" value={a.id} />
                    </ActionForm>
                  ) : null}
                </section>
              );
            })}
          </div>
        ) : <EmptyState>Nothing waiting to be sent.</EmptyState>}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Sent and expired ({sent.length})</h2>
        {sent.length ? (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Applicant</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Sent</th><th className="px-3 py-2 font-medium">Opened</th><th className="px-3 py-2 font-medium">Expires</th><th className="px-3 py-2"></th></tr></thead>
              <tbody className="divide-y divide-border">
                {sent.map((a) => {
                  const o = offerByApp.get(a.id);
                  return (
                    <tr key={a.id}>
                      <td className="px-3 py-2"><Link href={`/staff/applications/${a.id}`} className="font-medium hover:underline">{a.child_first_name} {a.child_last_name}</Link><span className="ml-2 text-xs text-muted-foreground">{one(a.grades)?.name} · {one(a.campuses)?.name}</span></td>
                      <td className="px-3 py-2"><Badge variant={o?.status === "viewed" ? "info" : o?.status === "expired" ? "warning" : "secondary"}>{o?.status ?? a.status}</Badge></td>
                      <td className="px-3 py-2 text-xs">{o?.sent_at ? formatDate(o.sent_at) : "—"}</td>
                      <td className="px-3 py-2 text-xs">{o?.first_viewed_at ? formatDate(o.first_viewed_at) : "not yet"}</td>
                      <td className="px-3 py-2 text-xs">{o?.expires_at ? formatDate(o.expires_at) : "—"}</td>
                      <td className="px-3 py-2">
                        {canApprove && o ? (
                          <ActionForm action={withdrawOffer} label="Withdraw & re-draft" size="xs" variant="ghost" className="flex items-center gap-2" confirm="Withdraw this offer? The parent's link will stop working and you can issue a corrected one.">
                            <input type="hidden" name="applicationId" value={a.id} /><input type="hidden" name="offerId" value={o.id} />
                            <Input name="reason" placeholder="Why" className="h-7 w-40 md:h-7" required />
                          </ActionForm>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState>No offers out.</EmptyState>}
      </section>
    </>
  );
}
