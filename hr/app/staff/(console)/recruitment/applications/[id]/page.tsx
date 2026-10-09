import { notFound } from "next/navigation";
import { AlertTriangle, FileText, Info, Mail, Phone, ShieldAlert } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { ScoreBadge, StageBadge } from "@/components/recruitment/badges";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { judgeAnswer, REASON_LABELS } from "@/lib/integrity/signals";
import { can } from "@/lib/permissions";
import { BAND_LABELS, COMPETENCY_LABELS } from "@/lib/questions/rubric";
import { loadApplicationBundle } from "@/lib/recruitment/bundle";
import { STAGE_LABELS } from "@/lib/recruitment/engine";
import { formatMonths, summariseTenure } from "@/lib/recruitment/tenure";
import { RATING_KEYS, RATING_LABELS } from "@/lib/references";
import type { Section, Flag } from "@/lib/scoring/score";
import { scoreApplication } from "@/lib/scoring/score";
import { scoreInputFrom } from "@/lib/scoring/recompute";
import { getHrSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";
import type { PipelineStage } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import {
  addNoteAction,
  closeInterviewAction,
  hireAction,
  markAnswerAction,
  markCommunicationAction,
  moveStageAction,
  scheduleInterviewAction,
  sendOfferAction,
} from "../../actions";

const QUALIFICATION_LABELS: Record<string, string> = {
  certificate: "Certificate",
  diploma: "Diploma",
  degree: "Degree",
  honours: "Honours",
  postgraduate_certificate: "Postgraduate certificate",
  masters: "Master's",
  doctorate: "Doctorate",
  other: "Other",
};

const REF_STATUS: Record<string, string> = {
  pending: "Not sent yet",
  sent: "Emailed, not opened",
  opened: "Opened, not answered",
  received: "Received",
  declined: "Declined",
  expired: "No answer in time",
};

/**
 * One applicant, everything about them on one page, in the order a person
 * reads to decide: the score and its flags, how the answers were written,
 * the answers themselves, career, compliance, references, then the actions.
 * Read through the staff member's own client: without the compliance
 * permission the compliance section and the sensitive documents are absent,
 * because RLS returns nothing.
 */
export default async function ApplicationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hired?: string }> }) {
  const { id } = await params;
  const { hired } = await searchParams;
  const ctx = await requireStaff("hr.recruitment.read");
  const bundle = await loadApplicationBundle(ctx.supabase, id);
  if (!bundle) notFound();
  const { application: a, vacancy, campus } = bundle;

  const settings = await getHrSettings(ctx.supabase);
  // Recomputed for display from the same rows the stored score came from, so
  // the breakdown is never stale while a rescore is queued.
  const score = a.status === "draft" || a.status === "anonymised" ? null : scoreApplication(scoreInputFrom(bundle, settings.scoringWeights));
  const tenure = summariseTenure(bundle.employment);

  const [{ data: notes }, { data: events }] = await Promise.all([
    ctx.supabase.from("hr_application_notes").select("*").eq("application_id", a.id).order("created_at", { ascending: false }),
    ctx.supabase.from("hr_application_events").select("*").eq("application_id", a.id).order("id", { ascending: false }).limit(50),
  ]);
  const authorIds = [...new Set((notes ?? []).map((n) => n.author_id).filter((x): x is string => !!x))];
  const { data: authors } = authorIds.length ? await ctx.supabase.from("staff_profiles").select("id, full_name").in("id", authorIds) : { data: [] };
  const authorName = new Map((authors ?? []).map((p) => [p.id, p.full_name]));

  const canWrite = can(ctx.permissions, "hr.recruitment.write") && a.status === "submitted";
  const canHire = can(ctx.permissions, "hr.recruitment.hire") && a.status === "submitted";
  const canCompliance = can(ctx.permissions, "hr.recruitment.compliance.read");
  const answersByQ = new Map(bundle.answers.map((x) => [x.vacancy_question_id, x]));
  const refereeById = new Map(bundle.referees.map((r) => [r.id, r]));
  const responseByRequest = new Map(bundle.responses.map((r) => [r.request_id, r]));
  const integrity = bundle.questions.map((q) => {
    const ans = answersByQ.get(q.id);
    return ans ? judgeAnswer({ text: ans.answer_text, behaviour: (ans.integrity ?? {}) as Record<string, number>, model: ans.ai_likelihood, duplicateSimilarity: ans.duplicate_similarity }) : null;
  });
  const flaggedCount = integrity.filter((v) => v && (v.level === "high" || v.level === "medium")).length;
  const scheduled = bundle.interviews.filter((i) => i.status === "scheduled");

  return (
    <>
      <PageTitle title={`${a.first_name} ${a.last_name}`} description={`${vacancy.title} · ${campus.name} · ${a.reference}`} back={{ href: `/staff/recruitment/pipeline?vacancy=${vacancy.id}`, label: "Pipeline" }}>
        <StageBadge stage={a.stage} status={a.status} />
      </PageTitle>
      {hired ? <p className="mb-4 rounded-xl bg-success/12 px-4 py-3 text-sm font-medium text-success">Hired. The application is kept and will not be removed by retention.</p> : null}

      <nav aria-label="On this page" className="mb-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {["Score", "Integrity", "Answers", "Career", ...(canCompliance ? ["Compliance"] : []), "Documents", "References", "Interviews", "Notes", "Timeline"].map((s) => (
          <a key={s} href={`#${s.toLowerCase()}`} className="hover:text-foreground">
            {s}
          </a>
        ))}
      </nav>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {/* Score */}
          <section id="score" className="surface scroll-mt-6 p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-semibold">Score</h2>
                <p className="text-sm text-muted-foreground">Five qualities. A quality with nothing to score yet is left out, not counted as zero.</p>
              </div>
              {score ? <ScoreBadge total={score.total} available={score.available} size="lg" /> : <span className="text-sm text-muted-foreground">Scored once the application is sent.</span>}
            </div>
            {score ? (
              <>
                <ul className="mt-5 space-y-3">
                  {score.sections.map((s: Section) => (
                    <li key={s.key} className="grid gap-1 sm:grid-cols-[14rem_1fr_5rem] sm:items-center sm:gap-4">
                      <span className="text-sm font-medium">{s.label}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${(s.fraction ?? 0) * 100}%`, opacity: s.points === null ? 0.25 : 1 }} />
                      </span>
                      <span className="text-sm tabular-nums sm:text-right">{s.points === null ? "Not yet" : `${s.points} / ${s.weight}`}</span>
                      {s.notes.length ? <span className="text-xs text-muted-foreground sm:col-span-3">{s.notes.join(" · ")}</span> : null}
                    </li>
                  ))}
                </ul>
                {score.flags.length ? (
                  <ul className="mt-5 space-y-2 border-t border-border/70 pt-4">
                    {score.flags.map((f: Flag) => (
                      <li key={f.code} className={cn("flex items-start gap-2 text-sm", f.severity === "critical" ? "text-destructive" : f.severity === "warning" ? "text-warning-foreground" : "text-muted-foreground")}>
                        {f.severity === "critical" ? <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> : f.severity === "warning" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0" aria-hidden />}
                        <span className={cn(f.severity === "critical" && "font-semibold")}>{f.label}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </section>

          {/* Integrity */}
          <section id="integrity" className="surface scroll-mt-6 p-5">
            <h2 className="font-semibold">AI-writing check</h2>
            <p className="text-sm text-muted-foreground">
              Every application is checked three ways: how each answer was written, an AI review of the wording, and a comparison with every other applicant&apos;s answers. A flag is a reason to ask in the interview, never a reason on its own to reject. Checkers are often wrong about people writing well in a second language.
            </p>
            <p className={cn("mt-3 text-sm font-semibold", flaggedCount ? "text-warning-foreground" : "text-success")}>
              {flaggedCount ? `${flaggedCount} of ${bundle.questions.length} answers flagged` : integrity.some((v) => v?.level === "unchecked") ? "Not fully checked yet" : "Nothing flagged"}
            </p>
            <ol className="mt-3 space-y-2">
              {bundle.questions.map((q, i) => {
                const v = integrity[i];
                const ans = answersByQ.get(q.id);
                if (!v || !ans) return null;
                const modelReasons = Array.isArray(ans.ai_likelihood_reasons) ? (ans.ai_likelihood_reasons as string[]) : [];
                return (
                  <li key={q.id} className="grid gap-1 rounded-lg bg-muted/40 px-3 py-2 text-sm sm:grid-cols-[2rem_8rem_1fr]">
                    <span className="font-semibold text-muted-foreground tabular-nums">Q{i + 1}</span>
                    <span className={cn("font-semibold", v.level === "high" ? "text-destructive" : v.level === "medium" ? "text-warning-foreground" : v.level === "unchecked" ? "text-muted-foreground" : "text-success")}>
                      {v.level === "high" ? "Likely AI" : v.level === "medium" ? "Possibly AI" : v.level === "unchecked" ? "Not checked yet" : "Looks own work"}
                    </span>
                    <span className="text-muted-foreground">
                      {[...v.reasons.map((r) => REASON_LABELS[r]), ...modelReasons].join(". ") || `Pasted ${Math.round(v.pastedShare * 100)}% of the text.`}
                      {ans.duplicate_of_answer_id ? (
                        <>
                          {" "}
                          <span className="font-medium text-foreground">Similar answer ({Math.round((ans.duplicate_similarity ?? 0) * 100)}%) from another applicant.</span>
                        </>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Answers */}
          <section id="answers" className="surface scroll-mt-6 p-5">
            <h2 className="font-semibold">Written answers</h2>
            <p className="text-sm text-muted-foreground">The AI suggests a band against each rubric. Your band replaces it in the score.</p>
            <ol className="mt-4 space-y-6">
              {bundle.questions.map((q, i) => {
                const ans = answersByQ.get(q.id);
                const effective = ans?.human_band ?? ans?.ai_band ?? null;
                const evidence = Array.isArray(ans?.ai_evidence) ? (ans!.ai_evidence as string[]) : [];
                return (
                  <li key={q.id} className="border-t border-border/70 pt-4 first:border-t-0 first:pt-0">
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Q{i + 1} · {COMPETENCY_LABELS[q.competency] ?? q.competency}
                    </p>
                    <p className="mt-1 font-medium">{q.prompt}</p>
                    <blockquote className="mt-2 max-w-[75ch] rounded-lg border-l-0 bg-muted/40 px-4 py-3 text-[15px] leading-relaxed whitespace-pre-wrap">{ans?.answer_text?.trim() || <span className="text-muted-foreground">No answer.</span>}</blockquote>
                    <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-3 text-sm">
                      <div className="min-w-0 flex-1">
                        {ans?.ai_band !== null && ans?.ai_band !== undefined ? (
                          <p>
                            <span className="font-medium">AI suggests band {ans.ai_band} ({BAND_LABELS[ans.ai_band]}).</span> <span className="text-muted-foreground">{ans.ai_rationale}</span>
                            {evidence.length ? <span className="mt-1 block text-xs text-muted-foreground">Evidence: {evidence.map((e) => `"${e}"`).join(", ")}</span> : null}
                          </p>
                        ) : (
                          <p className="text-muted-foreground">Not marked by AI yet.</p>
                        )}
                        {ans?.human_band !== null && ans?.human_band !== undefined ? (
                          <p className="mt-1 font-medium text-primary">
                            Marked band {ans.human_band} by a person{ans.human_note ? `: ${ans.human_note}` : "."}
                          </p>
                        ) : null}
                      </div>
                      {canWrite && ans ? (
                        <ActionForm action={markAnswerAction.bind(null, a.id, ans.id)} label="Save band" size="sm" variant="outline" resetOnSubmit={false} className="flex flex-wrap items-end gap-2 space-y-0">
                          <label className="text-xs">
                            <span className="mb-1 block text-muted-foreground">Your band</span>
                            <select name="band" defaultValue={ans.human_band === null ? "" : String(ans.human_band)} className="h-8 rounded-lg border border-input bg-card px-2 text-sm">
                              <option value="">Use AI ({effective ?? "none"})</option>
                              {[0, 1, 2, 3, 4].map((b) => (
                                <option key={b} value={b}>
                                  {b} · {BAND_LABELS[b]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <input name="note" defaultValue={ans.human_note ?? ""} placeholder="Why (optional)" className="h-8 w-40 rounded-lg border border-input bg-card px-2 text-sm" />
                        </ActionForm>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
            <div className="mt-6 flex flex-wrap items-end justify-between gap-4 border-t border-border/70 pt-4 text-sm">
              <div>
                <p className="font-medium">Communication across all answers</p>
                <p className="text-muted-foreground">
                  {a.communication_ai_band !== null ? `AI suggests band ${a.communication_ai_band}. ${a.communication_ai_rationale ?? ""}` : "Not marked by AI yet."}
                  {a.communication_human_band !== null ? ` A person set band ${a.communication_human_band}.` : ""}
                </p>
              </div>
              {canWrite ? (
                <ActionForm action={markCommunicationAction.bind(null, a.id)} label="Save" size="sm" variant="outline" resetOnSubmit={false} className="flex items-end gap-2 space-y-0">
                  <select name="band" defaultValue={a.communication_human_band === null ? "" : String(a.communication_human_band)} className="h-8 rounded-lg border border-input bg-card px-2 text-sm" aria-label="Communication band">
                    <option value="">Use AI</option>
                    {[0, 1, 2, 3, 4].map((b) => (
                      <option key={b} value={b}>
                        {b} · {BAND_LABELS[b]}
                      </option>
                    ))}
                  </select>
                </ActionForm>
              ) : null}
            </div>
          </section>

          {/* Career */}
          <section id="career" className="surface scroll-mt-6 p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="font-semibold">Career and qualifications</h2>
              <p className="text-sm text-muted-foreground">
                {formatMonths(tenure.schoolMonths)} in schools · average {tenure.averageMonths === null ? "n/a" : formatMonths(tenure.averageMonths)} per job
              </p>
            </div>
            {bundle.employment.length ? (
              <table className="data-table mt-3">
                <thead>
                  <tr>
                    <th>Employer</th>
                    <th>Role</th>
                    <th>Dates</th>
                    <th className="text-right">Stayed</th>
                  </tr>
                </thead>
                <tbody>
                  {bundle.employment.map((j, i) => (
                    <tr key={j.id}>
                      <td>
                        {j.employer}
                        {!j.is_school ? <span className="ml-1 text-xs text-muted-foreground">(not a school)</span> : null}
                      </td>
                      <td>
                        {j.role_title}
                        {j.reason_for_leaving ? <span className="block text-xs text-muted-foreground">Left: {j.reason_for_leaving}</span> : null}
                      </td>
                      <td className="tabular-nums">
                        {formatDate(j.start_on)} to {j.end_on ? formatDate(j.end_on) : "now"}
                      </td>
                      <td className="text-right tabular-nums">{formatMonths(tenure.jobs[i]?.months ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No jobs listed.</p>
            )}
            {tenure.gaps.length ? <p className="mt-2 text-sm text-muted-foreground">Gaps: {tenure.gaps.map((g) => `${formatMonths(g.months)} from ${formatDate(g.fromOn)}`).join("; ")}</p> : null}
            <ul className="mt-4 space-y-1 text-sm">
              {bundle.qualifications.map((q) => (
                <li key={q.id}>
                  <span className="font-medium">{q.title}</span> · {QUALIFICATION_LABELS[q.level]} · {q.institution}
                  {q.year_completed ? `, ${q.year_completed}` : ""}
                  {q.is_teaching ? <span className="ml-2 rounded-full bg-success/12 px-2 py-0.5 text-xs font-semibold text-success">Teaching</span> : null}
                </li>
              ))}
            </ul>
          </section>

          {/* Compliance */}
          {canCompliance ? (
            <section id="compliance" className="surface scroll-mt-6 p-5">
              <h2 className="font-semibold">Compliance</h2>
              {bundle.compliance ? (
                <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <Fact label="Teacher registration" value={bundle.compliance.registration_body === "none" ? "Not registered yet" : `${bundle.compliance.registration_body} ${bundle.compliance.registration_number ?? ""}${bundle.compliance.registration_expires_on ? `, valid until ${formatDate(bundle.compliance.registration_expires_on)}` : ""}`} />
                  <Fact label="Citizen" value={a.is_citizen === null ? "Not answered" : a.is_citizen ? "Yes" : `No${a.nationality ? ` (${a.nationality})` : ""}`} />
                  <Fact label="Work permit" value={bundle.compliance.needs_permit ? `${bundle.compliance.permit_type ?? "Permit"} ${bundle.compliance.permit_number ?? ""}${bundle.compliance.permit_expires_on ? `, valid until ${formatDate(bundle.compliance.permit_expires_on)}` : ", not yet issued"}` : "Not needed"} />
                  <Fact label="Police clearance" value={bundle.compliance.police_clearance === "have" ? `Issued ${formatDate(bundle.compliance.police_clearance_issued_on)}` : bundle.compliance.police_clearance === "applied" ? "Applied for" : "None yet"} />
                  <Fact label="Child-protection registers" value={bundle.compliance.child_protection_clear ? "Declared not listed" : "Did NOT declare clear"} danger={bundle.compliance.child_protection_clear === false} />
                  <Fact label="Criminal record" value={bundle.compliance.criminal_record ? `Yes: ${bundle.compliance.criminal_record_detail}` : "No"} danger={!!bundle.compliance.criminal_record} />
                  <Fact label="Dismissed before" value={bundle.compliance.dismissed_before ? `Yes: ${bundle.compliance.dismissed_detail}` : "No"} danger={!!bundle.compliance.dismissed_before} />
                  <Fact label="Concern about conduct with children" value={bundle.compliance.safeguarding_concern ? `Yes: ${bundle.compliance.safeguarding_detail}` : "No"} danger={!!bundle.compliance.safeguarding_concern} />
                  <Fact label="Signed" value={`${bundle.compliance.declaration_name ?? ""}, ${formatDate(bundle.compliance.declared_at)}`} />
                </dl>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">Not completed.</p>
              )}
            </section>
          ) : null}

          {/* Documents */}
          <section id="documents" className="surface scroll-mt-6 p-5">
            <h2 className="font-semibold">Documents</h2>
            {bundle.documents.length ? (
              <ul className="mt-3 space-y-1.5 text-sm">
                {bundle.documents.map((d) => (
                  <li key={d.id}>
                    <a href={`/staff/documents/${d.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 hover:text-primary hover:underline">
                      <FileText className="size-4" aria-hidden /> {d.file_name}
                    </a>
                    <span className="ml-2 text-xs text-muted-foreground capitalize">{d.kind.replace("_", " ")}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">None you can see.</p>
            )}
          </section>

          {/* References */}
          <section id="references" className="surface scroll-mt-6 p-5">
            <h2 className="font-semibold">References</h2>
            <ul className="mt-3 space-y-4">
              {bundle.requests.map((req) => {
                const referee = refereeById.get(req.referee_id);
                const resp = responseByRequest.get(req.id);
                const ratings = (resp?.ratings ?? {}) as Record<string, number>;
                return (
                  <li key={req.id} className={cn("rounded-xl border border-border/70 p-4", resp?.concern && "border-destructive/50 bg-destructive/5")}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {referee?.full_name} <span className="text-sm font-normal text-muted-foreground">· {referee?.role_title ?? referee?.relationship} at {referee?.organisation}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {referee?.email}
                          {referee?.is_most_recent_employer ? " · Most recent employer" : ""}
                        </p>
                      </div>
                      <span className="text-xs font-semibold">{REF_STATUS[req.status]}</span>
                    </div>
                    {resp ? (
                      <div className="mt-3 space-y-2 text-sm">
                        {resp.concern ? (
                          <p className="flex items-start gap-2 font-semibold text-destructive">
                            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> Concern raised: <span className="font-normal">{resp.concern_detail}</span>
                          </p>
                        ) : null}
                        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                          {RATING_KEYS.map((k) => (
                            <div key={k} className="flex justify-between gap-2">
                              <dt className="text-muted-foreground">{RATING_LABELS[k]}</dt>
                              <dd className="font-semibold tabular-nums">{ratings[k] ?? "?"}/5</dd>
                            </div>
                          ))}
                        </dl>
                        <p>
                          Recommends: <span className="font-semibold">{resp.recommendation === "yes" ? "Yes" : resp.recommendation === "with_reservations" ? "Yes, with reservations" : "No"}</span> · Would re-employ:{" "}
                          <span className="font-semibold">{resp.would_reemploy === "yes" ? "Yes" : resp.would_reemploy === "no" ? "No" : "Not their decision"}</span>
                        </p>
                        {resp.role_and_dates_confirmed === false ? <p className="text-warning-foreground">Role or dates differ: {resp.role_and_dates_note}</p> : null}
                        {resp.reason_for_leaving ? <p className="text-muted-foreground">Reason for leaving: {resp.reason_for_leaving}</p> : null}
                        {resp.comments ? <p className="text-muted-foreground">&ldquo;{resp.comments}&rdquo;</p> : null}
                        <p className="text-xs text-muted-foreground">Signed {resp.referee_name_confirmed}, {formatDateTime(resp.submitted_at)}</p>
                      </div>
                    ) : req.declined_reason ? (
                      <p className="mt-2 text-sm text-muted-foreground">Declined: {req.declined_reason}</p>
                    ) : null}
                  </li>
                );
              })}
              {!bundle.requests.length ? <li className="text-sm text-muted-foreground">Referees are emailed when the application is sent.</li> : null}
            </ul>
          </section>

          {/* Interviews */}
          <section id="interviews" className="surface scroll-mt-6 p-5">
            <h2 className="font-semibold">Interviews</h2>
            {bundle.interviews.length ? (
              <ul className="mt-3 space-y-3 text-sm">
                {bundle.interviews.map((iv) => (
                  <li key={iv.id} className="rounded-xl border border-border/70 p-3">
                    <p className="font-medium">
                      {formatDateTime(iv.starts_at)} · {iv.mode === "in_person" ? "In person" : iv.mode === "video" ? "Video" : "Phone"} · <span className="capitalize">{iv.status}</span>
                    </p>
                    {iv.location ? <p className="text-muted-foreground">{iv.location}</p> : null}
                    {iv.panel ? <p className="text-muted-foreground">Panel: {iv.panel}</p> : null}
                    {iv.notes ? <p className="mt-1 whitespace-pre-wrap">{iv.notes}</p> : null}
                    {canWrite && iv.status === "scheduled" ? (
                      <ActionForm action={closeInterviewAction.bind(null, a.id, iv.id)} label="Save" size="sm" variant="outline" className="mt-2 flex flex-wrap items-end gap-2 space-y-0">
                        <select name="to" className="h-8 rounded-lg border border-input bg-card px-2" aria-label="Interview outcome">
                          <option value="completed">Mark as held</option>
                          <option value="cancelled">Cancel (emails the applicant)</option>
                        </select>
                        <input name="notes" placeholder="Interview notes" className="h-8 w-56 rounded-lg border border-input bg-card px-2" />
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">None booked.</p>
            )}
            {flaggedCount ? (
              <p className="mt-3 rounded-lg bg-warning/20 px-3 py-2 text-sm">
                Ask the applicant to talk through {flaggedCount === 1 ? "the flagged answer" : "the flagged answers"} (
                {integrity
                  .map((v, i) => (v && (v.level === "high" || v.level === "medium") ? `Q${i + 1}` : null))
                  .filter(Boolean)
                  .join(", ")}
                ) in the interview.
              </p>
            ) : null}
          </section>

          {/* Notes */}
          <section id="notes" className="surface scroll-mt-6 p-5">
            <h2 className="font-semibold">Notes</h2>
            {canWrite || can(ctx.permissions, "hr.recruitment.write") ? (
              <ActionForm action={addNoteAction.bind(null, a.id)} label="Add note" size="sm" className="mt-3">
                <textarea name="body" rows={2} maxLength={5000} placeholder="Only staff see notes." className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm" aria-label="Note" />
              </ActionForm>
            ) : null}
            <ul className="mt-4 space-y-3 text-sm">
              {(notes ?? []).map((n) => (
                <li key={n.id} className="border-t border-border/70 pt-3 first:border-t-0 first:pt-0">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {authorName.get(n.author_id ?? "") ?? "Staff"}, {formatDateTime(n.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          {/* Timeline */}
          <section id="timeline" className="surface scroll-mt-6 p-5">
            <h2 className="font-semibold">Timeline</h2>
            <ol className="mt-3 space-y-1.5 text-sm">
              {(events ?? []).map((e) => (
                <li key={e.id} className="grid grid-cols-[9.5rem_1fr] gap-3">
                  <span className="text-muted-foreground tabular-nums">{formatDateTime(e.occurred_at)}</span>
                  <span>{describeEvent(e.kind, e.detail as Record<string, unknown>)}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        {/* Actions */}
        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="surface space-y-1 p-5 text-sm">
            <p className="flex items-center gap-2">
              <Mail className="size-4 text-muted-foreground" aria-hidden />
              <a href={`mailto:${a.email}`} className="hover:underline">
                {a.email}
              </a>
            </p>
            {a.phone ? (
              <p className="flex items-center gap-2">
                <Phone className="size-4 text-muted-foreground" aria-hidden /> {a.phone}
              </p>
            ) : null}
            <p className="pt-1 text-muted-foreground">Sent {formatDate(a.submitted_at)}</p>
          </div>

          {canWrite && a.stage ? (
            <div className="surface space-y-3 p-5">
              <h2 className="font-semibold">Move to</h2>
              {(["review", "shortlisted", "unsuccessful"] as PipelineStage[])
                .filter((s) => s !== a.stage)
                .map((to) => (
                  <ActionForm key={to} action={moveStageAction.bind(null, a.id)} label={STAGE_LABELS[to]} variant={to === "unsuccessful" ? "outline" : "default"} size="lg">
                    <input type="hidden" name="to" value={to} />
                    <input type="hidden" name="expected" value={a.stage ?? ""} />
                    {to === "unsuccessful" ? <input name="reason" placeholder="Reason, for the record" className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm" /> : null}
                    {to !== "review" ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="notify" defaultChecked={to === "shortlisted"} className="size-4 accent-[var(--primary)]" />
                        Email the applicant ({to === "shortlisted" ? "shortlisted" : "not successful"})
                      </label>
                    ) : null}
                  </ActionForm>
                ))}
            </div>
          ) : null}

          {canWrite && a.stage === "shortlisted" ? (
            <div className="surface space-y-3 p-5">
              <h2 className="font-semibold">{scheduled.length ? "Book another interview" : "Invite to interview"}</h2>
              <p className="text-xs text-muted-foreground">The applicant gets an email with a calendar invitation.</p>
              <ActionForm action={scheduleInterviewAction.bind(null, a.id)} label="Book and email" size="lg">
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" name="date" required className="h-9 rounded-lg border border-input bg-card px-2 text-sm" aria-label="Date" />
                  <input type="time" name="time" required className="h-9 rounded-lg border border-input bg-card px-2 text-sm" aria-label="Time" />
                  <select name="minutes" defaultValue="60" className="h-9 rounded-lg border border-input bg-card px-2 text-sm" aria-label="Length">
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="90">90 minutes</option>
                  </select>
                  <select name="mode" defaultValue="in_person" className="h-9 rounded-lg border border-input bg-card px-2 text-sm" aria-label="How">
                    <option value="in_person">In person</option>
                    <option value="video">Video call</option>
                    <option value="phone">Phone call</option>
                  </select>
                </div>
                <input name="location" placeholder="Room, video link or phone number" className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm" />
                <input name="panel" placeholder="Panel (for staff only)" className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm" />
              </ActionForm>
            </div>
          ) : null}

          {canHire && a.stage === "shortlisted" ? (
            <div className="surface space-y-4 p-5">
              <h2 className="font-semibold">Offer and hire</h2>
              <ActionForm action={sendOfferAction.bind(null, a.id)} label="Email the offer" variant="outline" size="lg" confirm="Email this applicant an offer for the post?">
                <textarea name="note" rows={2} placeholder="Optional line for the email, e.g. the starting salary agreed" className="w-full rounded-lg border border-input bg-card px-2 py-1.5 text-sm" />
              </ActionForm>
              <ActionForm action={hireAction.bind(null, a.id)} label="Mark as hired" size="lg" confirm="Mark this applicant as hired?">
                <label className="block text-sm">
                  <span className="mb-1 block text-muted-foreground">Start date</span>
                  <input type="date" name="start_date" required className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm" />
                </label>
              </ActionForm>
            </div>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function Fact({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", danger && "text-destructive")}>{value}</dd>
    </div>
  );
}

function describeEvent(kind: string, detail: Record<string, unknown>): string {
  switch (kind) {
    case "started":
      return "Started the application";
    case "submitted":
      return "Sent the application";
    case "stage_changed":
      return `Moved from ${detail.from ?? "nowhere"} to ${detail.to}${detail.reason ? ` (${detail.reason})` : ""}`;
    case "reference_received":
      return `Reference received from ${detail.referee}${detail.concern ? ", with a concern" : ""}`;
    case "interview_booked":
      return "Interview booked";
    case "offer_sent":
      return "Offer emailed";
    case "hired":
      return "Hired";
    case "withdrawn":
      return "Withdrew the application";
    case "ai_marking_incomplete":
      return "AI could not mark every answer; a person should mark the rest";
    case "ai_integrity_not_checked":
      return "The AI-writing check could not run";
    case "anonymised":
      return "Personal data removed (retention)";
    default:
      return kind.replace(/_/g, " ");
  }
}
