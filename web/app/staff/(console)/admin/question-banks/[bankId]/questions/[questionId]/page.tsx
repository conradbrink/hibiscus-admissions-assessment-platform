import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_TYPE_LABELS, hasOptions, needsRubric, parseAnswerKey } from "@/lib/assessment/keys";
import { requireStaff } from "@/lib/staff/session";
import { addOption, deleteOption, deleteQuestion, saveKey, saveOption, saveQuestion, setQuestionStatus } from "../../../actions";

export default async function QuestionPage({ params }: { params: Promise<{ bankId: string; questionId: string }> }) {
  const { bankId, questionId } = await params;
  const { supabase } = await requireStaff("assessments.author");

  const [{ data: question }, { data: options }, { data: key }, { data: competencies }, { data: passages }, { data: rubrics }, { data: grades }] =
    await Promise.all([
      supabase.from("questions").select("*").eq("id", questionId).eq("bank_id", bankId).maybeSingle(),
      supabase.from("question_options").select("*").eq("question_id", questionId).order("side").order("position"),
      supabase.from("question_answers").select("*").eq("question_id", questionId).maybeSingle(),
      supabase.from("competencies").select("id, name, subjects(name)").eq("is_active", true).order("sort_order"),
      supabase.from("passages").select("id, title").eq("bank_id", bankId).order("title"),
      supabase.from("rubrics").select("id, name, max_marks").order("name"),
      supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
    ]);
  if (!question) notFound();

  const parsedKey = parseAnswerKey(question.type, key?.answer ?? null);
  const left = (options ?? []).filter((o) => o.side !== "right");
  const right = (options ?? []).filter((o) => o.side === "right");
  const hidden = (
    <>
      <input type="hidden" name="bankId" value={bankId} />
      <input type="hidden" name="questionId" value={question.id} />
    </>
  );
  const statusVariant = question.status === "active" ? "success" : question.status === "retired" ? "muted" : "outline";

  return (
    <>
      <PageTitle title={QUESTION_TYPE_LABELS[question.type]} description={`Version ${question.version}`}>
        <Badge variant={statusVariant}>{question.status}</Badge>
        {question.status !== "active" ? (
          <ActionForm action={setQuestionStatus} label="Activate" size="sm" variant="success">{hidden}<input type="hidden" name="status" value="active" /></ActionForm>
        ) : (
          <ActionForm action={setQuestionStatus} label="Retire" size="sm" variant="outline">{hidden}<input type="hidden" name="status" value="retired" /></ActionForm>
        )}
        {question.status === "draft" ? (
          <ActionForm action={deleteQuestion} label="Delete" size="sm" variant="destructive" confirm="Delete this draft question?">{hidden}</ActionForm>
        ) : null}
        <Link href={`/staff/admin/question-banks/${bankId}`} className="text-sm text-muted-foreground hover:underline">Back to bank</Link>
      </PageTitle>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold">The question</h2>
          <ActionForm action={saveQuestion} label="Save question" size="sm" className="space-y-3 rounded-xl border border-border bg-card p-4">
            {hidden}
            <input type="hidden" name="type" value={question.type} />
            <div className="space-y-1"><Label htmlFor="stem">Stem</Label><Textarea id="stem" name="stem" rows={4} defaultValue={question.stem} required /></div>
            <div className="space-y-1"><Label htmlFor="stemMediaPath">Image path (optional)</Label><Input id="stemMediaPath" name="stemMediaPath" defaultValue={question.stem_media_path ?? ""} placeholder="Path in the media store" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label>Competency</Label>
                <NativeSelect name="competencyId" defaultValue={question.competency_id} required>
                  {(competencies ?? []).map((c) => {
                    const subject = Array.isArray(c.subjects) ? c.subjects[0] : c.subjects;
                    return <option key={c.id} value={c.id}>{(subject as { name: string } | null)?.name} — {c.name}</option>;
                  })}
                </NativeSelect>
              </div>
              <div className="space-y-1"><Label>Passage</Label>
                <NativeSelect name="passageId" defaultValue={question.passage_id ?? ""}>
                  <option value="">None</option>
                  {(passages ?? []).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1"><Label htmlFor="marks">Marks</Label><Input id="marks" name="marks" type="number" step="0.5" min={0.5} max={100} defaultValue={question.marks} /></div>
              <div className="space-y-1"><Label>Difficulty</Label>
                <NativeSelect name="difficulty" defaultValue={String(question.difficulty)}>
                  {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1"><Label>From grade</Label>
                <NativeSelect name="gradeSortMin" defaultValue={question.grade_sort_min ?? ""}>
                  <option value="">Any</option>
                  {(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>{g.name}</option>)}
                </NativeSelect>
              </div>
              <div className="space-y-1"><Label>To grade</Label>
                <NativeSelect name="gradeSortMax" defaultValue={question.grade_sort_max ?? ""}>
                  <option value="">Any</option>
                  {(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>{g.name}</option>)}
                </NativeSelect>
              </div>
            </div>
          </ActionForm>

          {hasOptions(question.type) ? (
            <>
              <h2 className="mt-6 mb-2 text-sm font-semibold">{question.type === "matching" ? "Options — left and right columns" : question.type === "ordering" ? "Options — in the correct order" : "Options"}</h2>
              <div className="space-y-2">
                {[...left, ...right].map((o) => (
                  <div key={o.id} className="flex items-start gap-2">
                    <ActionForm action={saveOption} label="Save" size="xs" variant="outline" className="flex flex-1 items-center gap-2">
                      {hidden}<input type="hidden" name="optionId" value={o.id} />
                      {o.side ? <span className="w-10 text-xs text-muted-foreground">{o.side}</span> : null}
                      <Input name="position" type="number" min={1} max={50} defaultValue={o.position} className="h-8 w-16 md:h-8" />
                      <Input name="label" defaultValue={o.label} className="h-8 md:h-8" required />
                    </ActionForm>
                    <ActionForm action={deleteOption} label="Remove" size="xs" variant="ghost">{hidden}<input type="hidden" name="optionId" value={o.id} /></ActionForm>
                  </div>
                ))}
                <ActionForm action={addOption} label="Add option" size="xs" className="flex items-center gap-2 rounded-lg border border-dashed border-border p-2">
                  {hidden}
                  {question.type === "matching" ? (
                    <NativeSelect name="side" defaultValue="left" className="h-8 w-28 md:h-8"><option value="left">Left</option><option value="right">Right</option></NativeSelect>
                  ) : null}
                  <Input name="label" placeholder="Option text" className="h-8 md:h-8" required />
                </ActionForm>
              </div>
            </>
          ) : null}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">The answer key</h2>
          <p className="mb-2 text-xs text-muted-foreground">Only people who author questions can see this. The computer the child uses never receives it.</p>
          <ActionForm action={saveKey} label="Save key" size="sm" className="space-y-3 rounded-xl border border-border bg-card p-4">
            {hidden}
            {question.type === "single_choice" ? (
              <div className="space-y-1">
                {left.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="correctOptionId" value={o.id} defaultChecked={parsedKey?.type === "single_choice" && parsedKey.key.option_ids[0] === o.id} /> {o.label}
                  </label>
                ))}
                {!left.length ? <p className="text-xs text-muted-foreground">Add options first.</p> : null}
              </div>
            ) : null}
            {question.type === "multi_select" ? (
              <div className="space-y-1">
                {left.map((o) => (
                  <label key={o.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="correctOptionIds" value={o.id} defaultChecked={parsedKey?.type === "multi_select" && parsedKey.key.option_ids.includes(o.id)} /> {o.label}
                  </label>
                ))}
                <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name="partialCredit" value="1" defaultChecked={key?.partial_credit ?? false} /> Award marks per correct option rather than all-or-nothing</label>
              </div>
            ) : null}
            {question.type === "numeric" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1"><Label htmlFor="numericValue">Correct value</Label><Input id="numericValue" name="numericValue" type="number" step="any" defaultValue={parsedKey?.type === "numeric" ? parsedKey.key.value : ""} required /></div>
                <div className="space-y-1"><Label htmlFor="numericTolerance">Tolerance (±)</Label><Input id="numericTolerance" name="numericTolerance" type="number" step="any" min={0} defaultValue={parsedKey?.type === "numeric" ? parsedKey.key.tolerance : 0} /></div>
              </div>
            ) : null}
            {question.type === "short_text" ? (
              <div className="space-y-1">
                <Label htmlFor="acceptedAnswers">Accepted answers, one per line</Label>
                <Textarea id="acceptedAnswers" name="acceptedAnswers" rows={4} defaultValue={parsedKey?.type === "short_text" ? parsedKey.key.accepted.join("\n") : ""} required />
                <p className="text-xs text-muted-foreground">Matching ignores case, extra spaces and a final full stop.</p>
              </div>
            ) : null}
            {question.type === "matching" ? (
              <div className="space-y-2">
                {left.map((l) => {
                  const current = parsedKey?.type === "matching" ? parsedKey.key.pairs.find((p) => p[0] === l.id)?.[1] : undefined;
                  return (
                    <div key={l.id} className="grid grid-cols-2 items-center gap-2 text-sm">
                      <span>{l.label}</span>
                      <NativeSelect name={`pair_${l.id}`} defaultValue={current ?? ""} className="h-8 md:h-8">
                        <option value="">—</option>
                        {right.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                      </NativeSelect>
                    </div>
                  );
                })}
                {!left.length || !right.length ? <p className="text-xs text-muted-foreground">Add options to both columns first.</p> : null}
                <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" name="partialCredit" value="1" defaultChecked={key?.partial_credit ?? false} /> Award marks per correct pair</label>
              </div>
            ) : null}
            {question.type === "ordering" ? (
              <div className="space-y-2 text-sm">
                <p className="text-xs text-muted-foreground">The option order above is the correct order. The child sees them shuffled.</p>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="partialCredit" value="1" defaultChecked={key?.partial_credit ?? false} /> Award marks per option in the right place</label>
              </div>
            ) : null}
            {needsRubric(question.type) ? (
              <div className="space-y-1">
                <Label>Rubric</Label>
                <NativeSelect name="rubricId" defaultValue={key?.rubric_id ?? ""} required>
                  <option value="">Choose a rubric</option>
                  {(rubrics ?? []).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.max_marks} marks)</option>)}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">Writing is marked by an assessor against the rubric. The rubric&apos;s maximum should match this question&apos;s marks.</p>
              </div>
            ) : null}
          </ActionForm>
          <p className="mt-2 text-xs text-muted-foreground">
            Key status: {question.type === "ordering" ? (left.length >= 2 ? "defined by option order" : "needs two or more options") : needsRubric(question.type) ? (key?.rubric_id ? "rubric chosen" : "no rubric yet") : parsedKey ? "saved" : "not saved yet"}
          </p>
        </section>
      </div>
    </>
  );
}
