import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BAND_LABELS } from "@/lib/assessment/bands";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { formatMoney } from "@/lib/money";
import { feeSnapshotFrom } from "@/lib/offers/snapshot";
import { can, type PermissionSet } from "@/lib/permissions";
import type { ComputedProfile } from "@/lib/profile/compute";
import { NARRATIVE_SCHEMA } from "@/lib/profile/narrative";
import type { RuleResult } from "@/lib/rules/evaluate";
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
}: {
  supabase: StaffContext["supabase"];
  permissions: PermissionSet;
  app: Pick<ApplicationRow, "id" | "status" | "requires_assessment" | "child_first_name">;
}) {
  const [{ data: attempts }, { data: profile }, { data: decisions }, { data: offers }, { data: subjects }, { data: competencies }] = await Promise.all([
    supabase.from("attempts").select("*").eq("application_id", app.id).order("created_at", { ascending: false }),
    supabase.from("learning_profiles").select("*").eq("application_id", app.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("admission_decisions").select("*, staff_profiles(full_name)").eq("application_id", app.id).order("decided_at", { ascending: false }),
    can(permissions, "offers.read")
      ? supabase.from("offers").select("*").eq("application_id", app.id).order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
    supabase.from("subjects").select("id, name").order("sort_order"),
    supabase.from("competencies").select("id, name, subject_id").order("sort_order"),
  ]);
  const latestAttempt = attempts?.[0] ?? null;
  const { data: scores } = latestAttempt
    ? await supabase.from("attempt_scores").select("*").eq("attempt_id", latestAttempt.id)
    : { data: [] };
  const scopeName = (scope: string, id: string | null) =>
    scope === "overall" ? "Overall" : scope === "subject" ? subjects?.find((s) => s.id === id)?.name ?? "?" : competencies?.find((c) => c.id === id)?.name ?? "?";

  const canApprove = can(permissions, "offers.approve");
  const liveOffer = (offers ?? []).find((o) => ["draft", "pending_approval", "sent", "viewed", "expired"].includes(o.status)) ?? null;
  const computed = profile ? (profile.computed as unknown as ComputedProfile) : null;
  const narrative = profile ? NARRATIVE_SCHEMA.safeParse(profile.narrative) : null;
  const idField = <input type="hidden" name="applicationId" value={app.id} />;

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <Tabs defaultValue={app.requires_assessment ? "assessment" : "decision"}>
        <TabsList>
          <TabsTrigger value="assessment">Assessment</TabsTrigger>
          <TabsTrigger value="profile">Learning profile</TabsTrigger>
          <TabsTrigger value="decision">Decision</TabsTrigger>
          <TabsTrigger value="offer">Offer</TabsTrigger>
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
            <p className="text-muted-foreground">Not sat yet. Launch it from the check-in board on the day.</p>
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
                      <Input name="conditions" defaultValue={liveOffer.conditions ?? ""} placeholder="Conditions (optional)" className="h-8 w-64 md:h-8" />
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
                <ActionForm action={generateOffer} label="Generate offer" size="sm" className="flex flex-wrap items-center gap-2">
                  {idField}
                  <Input name="conditions" placeholder="Conditions (optional)" className="h-8 w-64 md:h-8" />
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
      </Tabs>
    </section>
  );
}
