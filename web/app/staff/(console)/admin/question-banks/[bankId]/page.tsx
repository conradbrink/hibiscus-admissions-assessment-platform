import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { EmptyState, PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_TYPES, QUESTION_TYPE_LABELS } from "@/lib/assessment/keys";
import { requireStaff } from "@/lib/staff/session";
import { createQuestion, deletePassage, savePassage, setBankStatus } from "../actions";

export default async function BankPage({
  params,
  searchParams,
}: {
  params: Promise<{ bankId: string }>;
  searchParams: Promise<{ competency?: string; type?: string; status?: string }>;
}) {
  const { bankId } = await params;
  const filters = await searchParams;
  const { supabase } = await requireStaff("assessments.author");

  const [{ data: bank }, { data: questions }, { data: passages }, { data: competencies }, { data: grades }] =
    await Promise.all([
      supabase.from("question_banks").select("*").eq("id", bankId).maybeSingle(),
      supabase
        .from("questions")
        .select("id, type, stem, marks, difficulty, status, competency_id, grade_sort_min, grade_sort_max, version")
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false }),
      supabase.from("passages").select("*").eq("bank_id", bankId).order("title"),
      supabase
        .from("competencies")
        .select("id, name, subject_id, subjects(name)")
        .eq("is_active", true)
        .order("sort_order"),
      supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
    ]);
  if (!bank) notFound();

  const competencyName = new Map((competencies ?? []).map((c) => [c.id, c.name]));
  const gradeName = (sort: number | null) => (sort === null ? "any" : (grades ?? []).find((g) => g.sort_order === sort)?.name ?? String(sort));
  const list = (questions ?? []).filter(
    (q) =>
      (!filters.competency || q.competency_id === filters.competency) &&
      (!filters.type || q.type === filters.type) &&
      (!filters.status || q.status === filters.status)
  );

  return (
    <>
      <PageTitle title={bank.name} description={bank.description ?? "Question bank"}>
        <Badge variant={bank.status === "active" ? "success" : bank.status === "retired" ? "muted" : "outline"}>{bank.status}</Badge>
        {bank.status !== "active" ? (
          <ActionForm action={setBankStatus} label="Activate bank" size="sm" variant="success">
            <input type="hidden" name="bankId" value={bank.id} /><input type="hidden" name="status" value="active" />
          </ActionForm>
        ) : (
          <ActionForm action={setBankStatus} label="Retire bank" size="sm" variant="outline" confirm="Retire this bank? Its questions will no longer be drawn into new sittings.">
            <input type="hidden" name="bankId" value={bank.id} /><input type="hidden" name="status" value="retired" />
          </ActionForm>
        )}
      </PageTitle>
      {bank.is_sample ? (
        <p className="mb-4 rounded-md bg-warning/20 px-3 py-2 text-sm text-warning-foreground">This is the sample bank from the development seed. It exists so the flow can be tried end to end; do not use it for real sittings.</p>
      ) : null}

      <h2 className="mb-2 text-sm font-semibold">Add a question</h2>
      <ActionForm action={createQuestion} label="Add question" size="sm" className="mb-6 grid gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-4">
        <input type="hidden" name="bankId" value={bank.id} />
        <NativeSelect name="type" required>
          {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}
        </NativeSelect>
        <NativeSelect name="competencyId" required>
          {(competencies ?? []).map((c) => {
            const subject = Array.isArray(c.subjects) ? c.subjects[0] : c.subjects;
            return <option key={c.id} value={c.id}>{(subject as { name: string } | null)?.name} — {c.name}</option>;
          })}
        </NativeSelect>
        <NativeSelect name="passageId" defaultValue="">
          <option value="">No passage</option>
          {(passages ?? []).map((p) => <option key={p.id} value={p.id}>Passage: {p.title}</option>)}
        </NativeSelect>
        <div className="grid grid-cols-2 gap-2">
          <Input name="marks" type="number" step="0.5" min={0.5} max={100} defaultValue={1} title="Marks" />
          <NativeSelect name="difficulty" defaultValue="3" title="Difficulty 1–5">
            {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>Difficulty {d}</option>)}
          </NativeSelect>
        </div>
        <div className="md:col-span-3"><Textarea name="stem" rows={2} placeholder="The question as the child reads it" required /></div>
        <div className="grid grid-cols-2 gap-2">
          <NativeSelect name="gradeSortMin" defaultValue="" title="From grade">
            <option value="">Any grade from</option>
            {(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}
          </NativeSelect>
          <NativeSelect name="gradeSortMax" defaultValue="" title="To grade">
            <option value="">to any grade</option>
            {(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>to {g.name}</option>)}
          </NativeSelect>
        </div>
      </ActionForm>

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">{list.length} question{list.length === 1 ? "" : "s"}</span>
        <form className="flex flex-wrap gap-2">
          <NativeSelect name="type" defaultValue={filters.type ?? ""} className="h-8 w-40 md:h-8">
            <option value="">All types</option>
            {QUESTION_TYPES.map((t) => <option key={t} value={t}>{QUESTION_TYPE_LABELS[t]}</option>)}
          </NativeSelect>
          <NativeSelect name="competency" defaultValue={filters.competency ?? ""} className="h-8 w-48 md:h-8">
            <option value="">All competencies</option>
            {(competencies ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
          <NativeSelect name="status" defaultValue={filters.status ?? ""} className="h-8 w-32 md:h-8">
            <option value="">Any status</option>
            <option value="draft">Draft</option><option value="active">Active</option><option value="retired">Retired</option>
          </NativeSelect>
          <button type="submit" className="rounded-md border border-border px-2 text-xs hover:bg-muted">Filter</button>
        </form>
      </div>
      {list.length ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Question</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Competency</th>
                <th className="px-3 py-2 font-medium">Grades</th>
                <th className="px-3 py-2 font-medium">Marks</th>
                <th className="px-3 py-2 font-medium">Diff.</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((q) => (
                <tr key={q.id}>
                  <td className="max-w-md px-3 py-2">
                    <Link href={`/staff/admin/question-banks/${bank.id}/questions/${q.id}`} className="line-clamp-2 font-medium hover:underline">{q.stem}</Link>
                  </td>
                  <td className="px-3 py-2 text-xs">{QUESTION_TYPE_LABELS[q.type]}</td>
                  <td className="px-3 py-2 text-xs">{competencyName.get(q.competency_id) ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{gradeName(q.grade_sort_min)} – {gradeName(q.grade_sort_max)}</td>
                  <td className="px-3 py-2 text-xs">{q.marks}</td>
                  <td className="px-3 py-2 text-xs">{q.difficulty}</td>
                  <td className="px-3 py-2"><Badge variant={q.status === "active" ? "success" : q.status === "retired" ? "muted" : "outline"}>{q.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No questions match. Add one above.</EmptyState>
      )}

      <h2 className="mt-8 mb-2 text-sm font-semibold">Reading passages</h2>
      <p className="mb-3 text-xs text-muted-foreground">A passage is shown above every question that references it. It is copied into the sitting at launch, so editing it later does not change what a child read.</p>
      <div className="space-y-3">
        {(passages ?? []).map((p) => (
          <div key={p.id} className="rounded-xl border border-border bg-card p-3">
            <ActionForm action={savePassage} label="Save" size="xs" variant="outline" className="space-y-2">
              <input type="hidden" name="bankId" value={bank.id} /><input type="hidden" name="passageId" value={p.id} />
              <Input name="title" defaultValue={p.title} required />
              <Textarea name="body" rows={4} defaultValue={p.body} required />
            </ActionForm>
            <ActionForm action={deletePassage} label="Delete passage" size="xs" variant="ghost" className="mt-1" confirm="Delete this passage? Questions that use it will lose it.">
              <input type="hidden" name="bankId" value={bank.id} /><input type="hidden" name="passageId" value={p.id} />
            </ActionForm>
          </div>
        ))}
        <ActionForm action={savePassage} label="Add passage" size="xs" className="space-y-2 rounded-xl border border-dashed border-border p-3">
          <input type="hidden" name="bankId" value={bank.id} />
          <Input name="title" placeholder="Passage title" required />
          <Textarea name="body" rows={3} placeholder="The text the child reads" required />
        </ActionForm>
      </div>
    </>
  );
}
