import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format-date";
import { isAnswered, needsFollowUp, summarise, type ResponseLike } from "@/lib/reenrolment/rules";
import { requireStaff } from "@/lib/staff/session";
import { studentName } from "@/lib/students/labels";
import { toSchoolDateString } from "@/lib/format-date";
import { closeCycle, openCycle, recordAnswer } from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

const INTENT_LABEL: Record<string, string> = {
  returning: "Coming back",
  not_returning: "Leaving",
  undecided: "Not sure yet",
};
const INTENT_TONE: Record<string, "success" | "destructive" | "warning"> = {
  returning: "success",
  not_returning: "destructive",
  undecided: "warning",
};

/**
 * The termly round: who is coming back, who is leaving, and — the number the
 * school actually plans around — how many places it can count on.
 *
 * Built to be worked from the phone as much as from the inbox. In the first
 * round most answers will arrive because somebody rang, so recording one by
 * hand is a first-class action rather than an afterthought.
 */
export default async function ReenrolmentPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { supabase } = await requireStaff("reenrolment.write");
  const params = await searchParams;
  const today = toSchoolDateString(new Date());

  const [{ data: cycles }, { data: intakes }, { data: campuses }] = await Promise.all([
    supabase
      .from("reenrolment_cycles")
      .select("*, intakes(label), campuses(name)")
      .order("opens_on", { ascending: false }),
    supabase.from("intakes").select("id, label, starts_on").order("starts_on"),
    supabase.from("v_accessible_campuses").select("id, name").order("name"),
  ]);

  const list = cycles ?? [];
  const current = params.cycle ? list.find((c) => c.id === params.cycle) : list.find((c) => c.status === "open") ?? list[0];

  const { data: responses } = current
    ? await supabase
        .from("reenrolment_responses")
        .select("*, students(legal_first_name, legal_last_name, preferred_name), campuses!reenrolment_responses_campus_id_fkey(name), grades(name)")
        .eq("cycle_id", current.id)
        .order("answered_at", { ascending: true, nullsFirst: true })
    : { data: [] };

  const rows = responses ?? [];
  const counts = summarise(rows as unknown as ResponseLike[]);

  return (
    <>
      <PageTitle
        title="Re-enrolment"
        description="Ask each term whether the child is coming back, and take the chance to check what we hold is still true."
      />

      <section className="surface mb-8 p-4">
        <h2 className="mb-3 text-sm font-semibold">Open a round</h2>
        <ActionForm action={openCycle} label="Open the round" size="sm">
          <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Term being asked about</span>
              <select name="intakeId" required className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                {(intakes ?? []).map((i) => (
                  <option key={i.id} value={i.id}>{i.label}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Campus</span>
              <select name="campusId" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                <option value="">Every campus</option>
                {(campuses ?? []).map((c) => (
                  <option key={c.id} value={c.id!}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Name</span>
              <input name="name" required maxLength={120} defaultValue="Term 1, 2027 — coming back?" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Opens</span>
              <input type="date" name="opensOn" required defaultValue={today} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-muted-foreground">Closes</span>
              <input type="date" name="closesOn" required className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" />
            </label>
            <label className="flex items-end gap-2 text-xs">
              <input type="checkbox" name="askDetails" defaultChecked className="size-4" />
              <span className="text-muted-foreground">Also ask them to confirm their details</span>
            </label>
          </div>
        </ActionForm>
        <p className="mt-2 text-xs text-muted-foreground">
          Opening writes one line per enrolled child in scope. Opening the same round again picks up
          children who have arrived since and changes no answer already given.
        </p>
      </section>

      {list.length > 1 ? (
        <form method="get" className="mb-4 flex items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Round</span>
            <select name="cycle" defaultValue={current?.id ?? ""} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.status}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm">Show</button>
        </form>
      ) : null}

      {current ? (
        <>
          <div className="surface mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">{current.name}</p>
              <p className="text-xs text-muted-foreground">
                {one(current.intakes)?.label ?? "—"} · {one(current.campuses)?.name ?? "every campus"} ·{" "}
                {formatDate(current.opens_on)} to {formatDate(current.closes_on)} · {current.status}
              </p>
            </div>
            {current.status !== "closed" ? (
              <ActionForm
                action={closeCycle}
                label="Close the round"
                variant="outline"
                size="sm"
                confirm="Close this round? Families who have not answered stay unanswered on the board."
              >
                <input type="hidden" name="cycleId" value={current.id} />
              </ActionForm>
            ) : null}
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Places to plan for", value: counts.expected, hint: "Only the families who said yes." },
              { label: "Coming back", value: counts.returning },
              { label: "Leaving", value: counts.notReturning },
              { label: "Not sure yet", value: counts.undecided },
              { label: "No answer", value: counts.unanswered },
              { label: "Details confirmed", value: counts.detailsConfirmed },
            ].map((t) => (
              <div key={t.label} className="surface p-3">
                <p className="text-xs text-muted-foreground">{t.label}</p>
                <p className="text-2xl font-semibold tabular-nums">{t.value}</p>
                {t.hint ? <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{t.hint}</p> : null}
              </div>
            ))}
          </div>

          {rows.length ? (
            <div className="overflow-x-auto surface">
              <table className="data-table">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Child</th>
                    <th className="px-3 py-2 font-medium">Campus</th>
                    <th className="px-3 py-2 font-medium">Answer</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                    <th className="px-3 py-2 font-medium">Record an answer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => {
                    const student = one(r.students);
                    const answered = isAnswered(r as unknown as ResponseLike);
                    return (
                      <tr key={r.id} className={needsFollowUp(r as unknown as ResponseLike) ? "" : "opacity-70"}>
                        <td className="px-3 py-2 text-sm">
                          {student ? studentName(student) : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs">{one(r.campuses)?.name ?? "—"}</td>
                        <td className="px-3 py-2">
                          {answered && r.intent ? (
                            <>
                              <Badge variant={INTENT_TONE[r.intent]}>{INTENT_LABEL[r.intent]}</Badge>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {r.answered_by === "staff" ? "by phone" : "online"}
                              </span>
                              {r.reason ? <span className="block text-xs text-muted-foreground">{r.reason}</span> : null}
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">no answer yet</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {r.details_confirmed_at ? formatDate(r.details_confirmed_at) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          <ActionForm action={recordAnswer} label="Save" variant="outline" size="xs">
                            <input type="hidden" name="responseId" value={r.id} />
                            <div className="mb-1 flex flex-wrap gap-1">
                              <select name="intent" defaultValue={r.intent ?? "returning"} className="h-8 rounded-md border border-border bg-background px-2 text-xs">
                                <option value="returning">Coming back</option>
                                <option value="not_returning">Leaving</option>
                                <option value="undecided">Not sure yet</option>
                              </select>
                              <input name="reason" maxLength={500} placeholder="Reason, if they gave one" className="h-8 w-48 rounded-md border border-border bg-background px-2 text-xs" />
                            </div>
                          </ActionForm>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState>
              No children in this round. Open it again once there are enrolled students at the campus
              it covers.
            </EmptyState>
          )}
        </>
      ) : (
        <EmptyState>No rounds yet. Open one above to ask a term&rsquo;s families.</EmptyState>
      )}
    </>
  );
}
