import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BAND_LABELS } from "@/lib/assessment/bands";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { MessagesPanel } from "@/components/staff/messages-panel";
import { OfferConditionsFields } from "@/components/staff/offer-conditions-fields";
import { PaymentPanel } from "@/components/staff/payment-panel";
import { registrationCompleteness, SECTION_LABELS, SECTIONS } from "@/lib/registration/completeness";
import { feeSnapshotFrom } from "@/lib/offers/snapshot";
import { can, type PermissionSet } from "@/lib/permissions";
import type { ComputedProfile } from "@/lib/profile/compute";
import { NARRATIVE_SCHEMA } from "@/lib/profile/narrative";
import type { RuleResult } from "@/lib/rules/evaluate";
import type { StaffActionState } from "@/components/staff/action-form";
import type { StaffContext } from "@/lib/staff/session";
import type { ApplicationRow, BenchmarkBand } from "@/lib/supabase/types";
import { approveOffer, generateOffer, withdrawOffer } from "@/app/staff/(console)/offers/actions";

/**
 * The assessment, profile, decision and offer for one applicant, as tabs on
 * the applicant page. Reads through the staff client so RLS applies; the
 * actions are the same ones the Offers & outcomes queue uses.
 */

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

// Static class names: Tailwind only emits classes it can see in the source.
const bandClass = (band: string) => (band === "exceeding" || band === "meeting" ? "text-success" : band === "approaching" ? "text-warning-foreground" : "text-destructive");

export async function ApplicantPhase2({
  supabase,
  permissions,
  app,
  gradeSort,
  sendWhatsApp,
}: {
  supabase: StaffContext["supabase"];
  permissions: PermissionSet;
  app: Pick<ApplicationRow, "id" | "status" | "requires_assessment" | "child_first_name">;
  gradeSort: number;
  /** The manual template send, from the applicant page's actions. */
  sendWhatsApp: (state: StaffActionState, formData: FormData) => Promise<StaffActionState>;
}) {
  const canSeePayments = can(permissions, "offers.read") || can(permissions, "finance.read");
  const [{ data: attempts }, { data: profile }, { data: decisions }, { data: offers }, { data: subjects }, { data: competencies }, { data: paymentRequest }, { data: payments }] = await Promise.all([
    supabase.from("attempts").select("*").eq("application_id", app.id).order("created_at", { ascending: false }),
    supabase.from("learning_profiles").select("*").eq("application_id", app.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("admission_decisions").select("*, staff_profiles(full_name)").eq("application_id", app.id).order("decided_at", { ascending: false }),
    can(permissions, "offers.read")
      ? supabase.from("offers").select("*").eq("application_id", app.id).order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
    supabase.from("subjects").select("id, name").order("sort_order"),
    supabase.from("competencies").select("id, name, subject_id").order("sort_order"),
    canSeePayments
      ? supabase.from("payment_requests").select("*").eq("application_id", app.id).order("created_at", { ascending: false }).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    can(permissions, "finance.read")
      ? supabase.from("payments").select("*").eq("application_id", app.id).order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);
  const registrationOpen = ["paid", "registration_incomplete", "registration_complete", "enrolled"].includes(app.status);
  const [{ data: registration }, { data: regContacts }, { data: documents }, { data: requirements }, { data: agreementTemplates }, { data: acceptances }] = registrationOpen
    ? await Promise.all([
        supabase.from("registrations").select("*").eq("application_id", app.id).maybeSingle(),
        supabase.from("registration_contacts").select("*").eq("application_id", app.id),
        supabase.from("documents").select("*").eq("application_id", app.id).is("deleted_at", null),
        supabase.from("document_requirements").select("*").eq("is_active", true),
        supabase.from("agreement_templates").select("*").eq("is_active", true),
        supabase.from("agreement_acceptances").select("*").eq("application_id", app.id),
      ])
    : [{ data: null }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
  const registrationState = registrationOpen
    ? registrationCompleteness({ registration: registration ?? null, contacts: regContacts ?? [], documents: documents ?? [], requirements: requirements ?? [], gradeSort, agreementTemplates: agreementTemplates ?? [], acceptances: acceptances ?? [] })
    : null;
  const latestAttempt = attempts?.[0] ?? null;
  const [{ data: scores }, { data: messages }, { data: messageTemplates }] = await Promise.all([
    latestAttempt ? supabase.from("attempt_scores").select("*").eq("attempt_id", latestAttempt.id) : Promise.resolve({ data: [] }),
    supabase.from("messages").select("*").eq("application_id", app.id).order("created_at", { ascending: false }).limit(50),
    supabase.from("message_templates").select("key, name, is_active, meta_template_name, twilio_content_sid, zavu_template_id").eq("is_active", true).order("name"),
  ]);
  // The trail behind those messages. Read separately rather than embedded so
  // a message with a long delivery history cannot push another message out of
  // the fifty above.
  const { data: messageEvents } = (messages ?? []).length
    ? await supabase
        .from("message_events")
        .select("*")
        .in("message_id", (messages ?? []).map((m) => m.id))
        .order("id")
    : { data: [] };
  const { data: gradeRows } = await supabase.from("grades").select("id, name, sort_order").eq("is_active", true).order("sort_order");
  const grades = gradeRows ?? [];
  const scopeName = (scope: string, id: string | null) =>
    scope === "overall" ? "Overall" : scope === "subject" ? subjects?.find((s) => s.id === id)?.name ?? "?" : competencies?.find((c) => c.id === id)?.name ?? "?";

  const canApprove = can(permissions, "offers.approve");
  const liveOffer = (offers ?? []).find((o) => ["draft", "pending_approval", "sent", "viewed", "expired"].includes(o.status)) ?? null;
  const computed = profile ? (profile.computed as unknown as ComputedProfile) : null;
  const narrative = profile ? NARRATIVE_SCHEMA.safeParse(profile.narrative) : null;
  const idField = <input type="hidden" name="applicationId" value={app.id} />;

  return (
    <section className="surface p-4">
      <Tabs defaultValue={app.requires_assessment ? "assessment" : "decision"}>
        <TabsList>
          <TabsTrigger value="assessment">Assessment</TabsTrigger>
          <TabsTrigger value="profile">Learning profile</TabsTrigger>
          <TabsTrigger value="decision">Decision</TabsTrigger>
          <TabsTrigger value="offer">Offer</TabsTrigger>
          <TabsTrigger value="payment">Payment</TabsTrigger>
          <TabsTrigger value="registration">Registration</TabsTrigger>
          <TabsTrigger value="messages">WhatsApp</TabsTrigger>
          <TabsTrigger value="downloads">Downloads</TabsTrigger>
        </TabsList>

        <TabsContent value="assessment" className="text-sm">
          {!app.requires_assessment ? (
            <p className="text-muted-foreground">Pre-school applicant: no assessment is required.</p>
          ) : attempts?.length ? (
            <div className="space-y-3">
              {attempts.map((at) => (
                <div key={at.id} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/staff/assessments/attempts/${at.id}`} className="font-medium hover:underline">Sitting on {formatDate(at.launched_at)}</Link>
                    {at.marking_status === "complete" ? (
                      <a href={`/staff/assessments/attempts/${at.id}/report`} target="_blank" rel="noopener" className="ml-2 text-xs font-medium text-primary hover:underline">Print report (PDF)</a>
                    ) : null}
                    <Badge variant={at.status === "marked" ? "success" : at.status === "abandoned" ? "secondary" : "info"}>{at.status.replace("_", " ")}</Badge>
                    {at.status === "submitted" ? <Badge variant={at.marking_status === "awaiting_rubric" ? "warning" : "secondary"}>{at.marking_status.replace("_", " ")}</Badge> : null}
                    {at.auto_submitted ? <span className="text-xs text-muted-foreground">auto-submitted at time limit</span> : null}
                    {at.time_multiplier !== 1 ? <span className="text-xs text-muted-foreground">{at.time_multiplier}× time{at.accommodation_note ? `: ${at.accommodation_note}` : ""}</span> : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {at.started_at ? `Started ${formatDateTime(at.started_at)}` : "Not started"}{at.submitted_at ? ` · submitted ${formatDateTime(at.submitted_at)}` : ""}
                  </p>
                  {at.id === latestAttempt?.id && scores?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {[...scores]
                        .sort((x, y) => (x.scope === "overall" ? -1 : y.scope === "overall" ? 1 : x.scope.localeCompare(y.scope)))
                        .map((s) => (
                          <span key={`${s.scope}:${s.scope_id}`} className="rounded-md border border-border px-2 py-0.5 text-xs">
                            {scopeName(s.scope, s.scope_id)} {s.percent}% · <span className={bandClass(s.band)}>{BAND_LABELS[s.band as BenchmarkBand] ?? s.band}</span>
                          </span>
                        ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">
              Not sat yet. On the day, open the{" "}
              <Link href="/staff/assessments/today" className="font-medium text-primary underline underline-offset-2">check-in board</Link>
              , check the child in and press Launch. The six-letter code and the address of the assessment page are shown there for the assessment computer.
            </p>
          )}
        </TabsContent>

        <TabsContent value="profile" className="text-sm">
          {!app.requires_assessment ? (
            <p className="text-muted-foreground">No assessment, so no learning profile.</p>
          ) : profile && computed && narrative?.success ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {profile.published_at ? `Published ${formatDateTime(profile.published_at)}` : "Not published"} · {profile.narrative_source === "ai" ? `AI narrative (${profile.ai_model ?? "model"}), validation ${profile.validation_status}` : `standard wording${profile.validation_status === "failed" ? " because the AI text failed validation" : ""}`}
              </p>
              <p>{narrative.data.summary}</p>
              {narrative.data.strengths_text ? <p><span className="font-medium">Strengths.</span> {narrative.data.strengths_text}</p> : null}
              {narrative.data.development_text ? <p><span className="font-medium">Next steps.</span> {narrative.data.development_text}</p> : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {computed.subjects.map((s) => (
                  <div key={s.id} className="rounded-lg border border-border p-2">
                    <p className="flex justify-between font-medium"><span>{s.name}</span><span className="tabular-nums">{s.percent}%</span></p>
                    <ul className="mt-1 text-xs text-muted-foreground">
                      {computed.competencies.filter((c) => c.subjectId === s.id).map((c) => (
                        <li key={c.id} className="flex justify-between"><span>{c.name}</span><span>{c.percent}% · {BAND_LABELS[c.band]}</span></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">The parent reads this at their profile link. Bands are the school&rsquo;s benchmarks; the wording never diagnoses or ranks.</p>
            </div>
          ) : (
            <p className="text-muted-foreground">Generated automatically once the assessment is marked.</p>
          )}
        </TabsContent>

        <TabsContent value="decision" className="text-sm">
          {decisions?.length ? (
            <ol className="space-y-3">
              {decisions.map((d) => {
                const inputs = (d.inputs ?? {}) as { results?: RuleResult[]; reason?: string; places_remaining?: number | null; ruleset_name?: string };
                const failing = (inputs.results ?? []).filter((r) => r.effect !== "pass");
                return (
                  <li key={d.id} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={d.final_outcome === "approved" ? "success" : d.final_outcome === "declined" ? "destructive" : "warning"}>{d.final_outcome.replace("_", " ")}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {d.decided_by === "rules" ? `Rules engine${d.ruleset_version ? ` (ruleset v${d.ruleset_version})` : ""}` : `${one(d.staff_profiles)?.full_name ?? "Staff"}`} · {formatDateTime(d.decided_at)}
                      </span>
                      {d.computed_outcome !== d.final_outcome ? <span className="text-xs text-muted-foreground">rules said {d.computed_outcome.replace("_", " ")}</span> : null}
                    </div>
                    {d.override_reason ? <p className="mt-1">{d.override_reason}</p> : null}
                    {inputs.reason ? <p className="mt-1 text-xs text-muted-foreground">{inputs.reason}</p> : null}
                    {typeof inputs.places_remaining === "number" ? <p className="mt-1 text-xs text-muted-foreground">Places remaining at the time: {inputs.places_remaining}</p> : null}
                    {failing.length ? (
                      <ul className="mt-1 text-xs text-muted-foreground">
                        {failing.map((f, i) => <li key={i}>{f.effect.replace("_", " ")}: {f.rule.label}{f.actual !== null ? ` (actual ${f.actual}%)` : ""}</li>)}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-muted-foreground">
              {app.status === "staff_review" || app.status === "awaiting_decision"
                ? <>Waiting for a person. Decide in the panel on the right or in the <Link href="/staff/decisions" className="text-primary underline underline-offset-2">review queue</Link>.</>
                : "No decision yet."}
            </p>
          )}
        </TabsContent>

        <TabsContent value="offer" className="text-sm">
          {offers === null ? (
            <p className="text-muted-foreground">You do not have permission to see offers.</p>
          ) : liveOffer ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={liveOffer.status === "viewed" || liveOffer.status === "sent" ? "info" : liveOffer.status === "expired" ? "warning" : "secondary"}>{liveOffer.status.replace("_", " ")}</Badge>
                <span className="text-xs text-muted-foreground">
                  Drafted {formatDateTime(liveOffer.created_at)}{liveOffer.sent_at ? ` · sent ${formatDateTime(liveOffer.sent_at)}` : ""}{liveOffer.first_viewed_at ? ` · opened ${formatDateTime(liveOffer.first_viewed_at)}` : ""}{liveOffer.expires_at ? ` · open until ${formatDate(liveOffer.expires_at)}` : ""}
                </span>
              </div>
              {(() => {
                const f = feeSnapshotFrom(liveOffer.fees);
                return f ? (
                  <ul className="rounded-lg border border-border p-2 text-xs">
                    {f.lines.map((l) => <li key={l.code} className="flex justify-between"><span>{l.label}</span><span className="tabular-nums">{formatMoney(l.amount_minor, f.currency)}</span></li>)}
                    <li className="mt-1 flex justify-between border-t border-border pt-1 font-semibold"><span>Payable on acceptance</span><span className="tabular-nums">{formatMoney(f.payable_at_acceptance_minor, f.currency)}</span></li>
                  </ul>
                ) : (
                  <p className="text-warning-foreground">No fee schedule covers this campus, grade and year, so the offer cannot be sent. <Link href="/staff/admin/fees" className="text-primary underline underline-offset-2">Configure fees</Link>, then generate again.</p>
                );
              })()}
              {liveOffer.conditions ? <p className="text-xs"><span className="font-medium">Conditions:</span> {liveOffer.conditions}</p> : null}
              {canApprove && (liveOffer.status === "draft" || liveOffer.status === "pending_approval") ? (
                <details className="text-xs">
                  <summary className="cursor-pointer text-primary">{liveOffer.conditions ? "Change the conditions" : "Add conditions"}</summary>
                  <ActionForm action={generateOffer} label="Apply conditions and re-draft" size="sm" variant="outline" className="mt-2 space-y-3" confirm="Re-draft this offer with these conditions? It still waits for approval.">
                    {idField}
                    <OfferConditionsFields grades={grades} currentGradeSort={gradeSort} compact />
                  </ActionForm>
                </details>
              ) : null}
              <details>
                <summary className="cursor-pointer text-primary">Preview as the parent reads it</summary>
                <div className="prose prose-sm mt-2 max-w-none rounded-lg border border-border bg-background p-4" dangerouslySetInnerHTML={{ __html: liveOffer.rendered_html + liveOffer.terms_html }} />
              </details>
              {canApprove ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {liveOffer.status === "pending_approval" ? (
                    <ActionForm action={approveOffer} label="Approve & send" size="sm" variant="success" confirm="Send this offer to the parent now?">
                      {idField}<input type="hidden" name="offerId" value={liveOffer.id} />
                    </ActionForm>
                  ) : null}
                  {liveOffer.status === "draft" ? (
                    <ActionForm action={generateOffer} label="Generate offer" size="sm" className="flex flex-wrap items-center gap-2">
                      {idField}
                    </ActionForm>
                  ) : null}
                  <ActionForm action={withdrawOffer} label="Withdraw & re-draft" size="sm" variant="ghost" className="flex items-center gap-2" confirm="Withdraw this offer? The parent's link stops working and a corrected one can be issued.">
                    {idField}<input type="hidden" name="offerId" value={liveOffer.id} />
                    <Input name="reason" placeholder="Why" className="h-8 w-44 md:h-8" required minLength={3} />
                  </ActionForm>
                  <Link href="/staff/offers" className="text-xs text-primary underline underline-offset-2">Offers & outcomes</Link>
                </div>
              ) : null}
            </div>
          ) : app.status === "approved" ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">Approved; the offer is being drafted. If nothing appears in a minute, generate it here.</p>
              {canApprove ? (
                <ActionForm action={generateOffer} label="Generate offer" size="sm" className="space-y-3">
                  {idField}
                  <OfferConditionsFields grades={grades} currentGradeSort={gradeSort} compact />
                </ActionForm>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground">
              {offers.length ? `${offers.length} earlier offer${offers.length === 1 ? "" : "s"} withdrawn. ` : ""}
              {app.status === "waitlisted" || app.status === "declined" ? "No offer for this outcome." : "No offer yet; one is drafted automatically on approval."}
            </p>
          )}
          {offers && offers.length > 1 ? (
            <ul className="mt-3 text-xs text-muted-foreground">
              {offers.filter((o) => o.id !== liveOffer?.id).map((o) => (
                <li key={o.id}>{o.status} · drafted {formatDate(o.created_at)}{o.withdrawn_reason ? ` · ${o.withdrawn_reason}` : ""}</li>
              ))}
            </ul>
          ) : null}
        </TabsContent>

        <TabsContent value="payment" className="text-sm">
          {!canSeePayments ? (
            <p className="text-muted-foreground">You do not have permission to see payments.</p>
          ) : paymentRequest ? (
            <PaymentPanel applicationId={app.id} request={paymentRequest} payments={payments} canWrite={can(permissions, "finance.write")} compact />
          ) : (
            <p className="text-muted-foreground">
              {["offer_accepted", "payment_required", "payment_processing", "paid"].includes(app.status)
                ? "No payment request found for this application; the offer may not have had fees payable on acceptance."
                : "Fees become due when the parent accepts the offer."}
            </p>
          )}
        </TabsContent>

        <TabsContent value="registration" className="text-sm">
          {registrationState ? (
            <div className="space-y-2">
              <ul className="flex flex-wrap gap-1.5">
                {SECTIONS.map((s) => (
                  <li key={s} className={`rounded-md border px-2 py-0.5 text-xs ${registrationState.sections[s] ? "border-success/40 text-success" : "border-border text-muted-foreground"}`}>{SECTION_LABELS[s]}{registrationState.sections[s] ? " ✓" : ""}</li>
                ))}
              </ul>
              {registrationState.missingDocuments.length ? <p className="text-xs text-warning-foreground">Missing: {registrationState.missingDocuments.map((d) => d.label).join(", ")}</p> : null}
              {registrationState.rejectedDocuments.length ? <p className="text-xs text-destructive">To upload again: {registrationState.rejectedDocuments.map((d) => d.label).join(", ")}</p> : null}
              {(documents ?? []).filter((d) => !d.superseded_by && d.review_status === "pending").length ? <p className="text-xs">{(documents ?? []).filter((d) => !d.superseded_by && d.review_status === "pending").length} document(s) waiting for review.</p> : null}
              <p><Link href={`/staff/registrations/${app.id}`} className="text-xs text-primary underline underline-offset-2">Open the registration</Link></p>
            </div>
          ) : (
            <p className="text-muted-foreground">Registration opens once the fees are paid.</p>
          )}
        </TabsContent>

        <TabsContent value="downloads" className="text-sm">
          {(() => {
            const pdf = (kind: string) => `/staff/applications/${app.id}/pdf/${kind}`;
            const reportAttempt = (attempts ?? []).find((at) => at.id === profile?.attempt_id) ?? latestAttempt;
            const succeeded = (payments ?? []).some((pm) => pm.status === "succeeded");
            const items: Array<{ label: string; blurb: string; href: string | null; why: string }> = [
              { label: "Offer letter", blurb: "The letter as the parent received it, with the fees and the signature.", href: (offers ?? []).some((o) => o.status !== "draft") ? pdf("offer") : null, why: offers === null ? "You do not have permission to see offers." : "No offer has been drafted yet." },
              { label: "Payment receipt", blurb: "The receipt for the fees paid on acceptance.", href: can(permissions, "finance.read") ? (succeeded ? pdf("receipt") : null) : null, why: can(permissions, "finance.read") ? "No successful payment recorded yet." : "Finance permission needed." },
              { label: "Learning profile", blurb: "The profile the parent reads at their results link.", href: profile?.published_at ? pdf("profile") : null, why: app.requires_assessment ? "Not published yet." : "No assessment for this grade." },
              { label: "Assessment report", blurb: "The assessor's printable report for the sitting, with every mark.", href: reportAttempt && profile ? `/staff/assessments/attempts/${reportAttempt.id}/report` : null, why: "Ready once the sitting is marked and the profile generated." },
              { label: "Registration record", blurb: "Everything the family gave at registration, the documents received and the agreements signed.", href: registration ? pdf("registration") : null, why: "Registration has not started." },
              { label: "Signed agreements", blurb: "Each policy in the version accepted, with the signature as drawn.", href: (acceptances ?? []).length ? pdf("agreements") : null, why: "No agreements signed yet." },
            ];
            return (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Every document the process has produced for this applicant, as a PDF. Each download is recorded in the audit log. The parent&rsquo;s uploaded documents are on the <Link href={`/staff/registrations/${app.id}`} className="text-primary underline underline-offset-2">registration page</Link>.</p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {items.map((it) => (
                    <li key={it.label} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block font-medium">{it.label}</span>
                        <span className="block text-xs text-muted-foreground">{it.blurb}</span>
                      </span>
                      {it.href ? (
                        <span className="flex gap-3 text-xs">
                          <a href={it.href} target="_blank" rel="noopener" className="font-medium text-primary hover:underline">Open PDF</a>
                          <a href={`${it.href}${it.href.includes("?") ? "&" : "?"}download=1`} className="font-medium text-primary hover:underline">Download</a>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{it.why}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="messages" className="text-sm">
          <MessagesPanel
            applicationId={app.id}
            messages={messages ?? []}
            events={messageEvents ?? []}
            // Either identifier will do here: which one is needed depends on
            // the provider the deploy is using, and the send records the exact
            // reason if the wrong one is the only one set.
            templates={(messageTemplates ?? []).filter((t) => t.meta_template_name || t.twilio_content_sid || t.zavu_template_id)}
            canSend={can(permissions, "applications.write")}
            action={sendWhatsApp}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
