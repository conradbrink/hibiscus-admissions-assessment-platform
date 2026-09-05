import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_TYPE_LABELS } from "@/lib/assessment/keys";
import { requireStaff } from "@/lib/staff/session";
import type { Json } from "@/lib/supabase/types";
import { deleteSection, saveSection, saveSectionQuestions, saveTemplate, setTemplateStatus } from "../actions";

function mixText(mix: Json | null): string {
  if (!mix || typeof mix !== "object" || Array.isArray(mix)) return "";
  return Object.entries(mix).map(([d, n]) => `${d}:${n}`).join(", ");
}

export default async function TemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { supabase } = await requireStaff("assessments.author");
  const [{ data: template }, { data: sections }, { data: subjects }, { data: grades }, { data: campuses }, { data: questions }] = await Promise.all([
    supabase.from("assessment_templates").select("*").eq("id", templateId).maybeSingle(),
    supabase.from("template_sections").select("*, template_section_questions(question_id, position)").eq("template_id", templateId).order("position"),
    supabase.from("subjects").select("id, name").order("sort_order"),
    supabase.from("grades").select("name, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
    supabase
      .from("questions")
      .select("id, stem, type, difficulty, marks, status, grade_sort_min, grade_sort_max, competency_id, competencies(name, subject_id), question_banks(name, status)")
      .in("status", ["active", "draft"])
      .order("difficulty"),
  ]);
  if (!template) notFound();

  const statusVariant = template.status === "active" ? "success" : template.status === "retired" ? "muted" : "outline";
  const hidden = <input type="hidden" name="templateId" value={template.id} />;

  return (
    <>
      <PageTitle title={template.name} description={template.description ?? "Assessment template"}>
        <Badge variant={statusVariant}>{template.status}</Badge>
        {template.status !== "active" ? (
          <ActionForm action={setTemplateStatus} label="Activate" size="sm" variant="success">{hidden}<input type="hidden" name="status" value="active" /></ActionForm>
        ) : (
          <ActionForm action={setTemplateStatus} label="Retire" size="sm" variant="outline" confirm="Retire this template? New sittings will not use it.">{hidden}<input type="hidden" name="status" value="retired" /></ActionForm>
        )}
        <Link href="/staff/admin/assessment-templates" className="text-sm text-muted-foreground hover:underline">All templates</Link>
      </PageTitle>

      <ActionForm action={saveTemplate} label="Save" size="sm" variant="outline" className="mb-6 grid gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-5">
        {hidden}
        <Input name="name" defaultValue={template.name} required className="md:col-span-2" />
        <NativeSelect name="gradeSortMin" defaultValue={template.grade_sort_min}>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>From {g.name}</option>)}</NativeSelect>
        <NativeSelect name="gradeSortMax" defaultValue={template.grade_sort_max}>{(grades ?? []).map((g) => <option key={g.sort_order} value={g.sort_order}>To {g.name}</option>)}</NativeSelect>
        <Input name="timeLimitMinutes" type="number" min={5} max={300} defaultValue={template.time_limit_minutes} title="Time limit, minutes" />
        <NativeSelect name="campusId" defaultValue={template.campus_id ?? ""} className="md:col-span-2"><option value="">Every campus</option>{(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} only</option>)}</NativeSelect>
        <Input name="description" defaultValue={template.description ?? ""} placeholder="Description" className="md:col-span-3" />
      </ActionForm>

      <h2 className="mb-2 text-sm font-semibold">Sections, in order</h2>
      <div className="space-y-4">
        {(sections ?? []).map((s) => {
          const picked = new Set((s.template_section_questions ?? []).map((q) => q.question_id));
          const candidates = (questions ?? []).filter((q) => {
            const comp = Array.isArray(q.competencies) ? q.competencies[0] : q.competencies;
            return (comp as { subject_id: string } | null)?.subject_id === s.subject_id;
          });
          return (
            <div key={s.id} className="rounded-xl border border-border bg-card p-4">
              <ActionForm action={saveSection} label="Save section" size="xs" variant="outline" className="grid gap-2 md:grid-cols-6">
                {hidden}<input type="hidden" name="sectionId" value={s.id} />
                <Input name="position" type="number" min={1} defaultValue={s.position} className="h-8 md:h-8" title="Position" />
                <Input name="title" defaultValue={s.title} className="h-8 md:col-span-2 md:h-8" required />
                <NativeSelect name="subjectId" defaultValue={s.subject_id} className="h-8 md:h-8">{(subjects ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect>
                <NativeSelect name="selection" defaultValue={s.selection} className="h-8 md:h-8"><option value="fixed">Fixed list</option><option value="random">Random draw</option></NativeSelect>
                <Input name="timeLimitMinutes" type="number" min={1} defaultValue={s.time_limit_minutes ?? ""} placeholder="Section minutes" className="h-8 md:h-8" />
                <Input name="randomCount" type="number" min={1} defaultValue={s.random_count ?? ""} placeholder="Random: how many" className="h-8 md:h-8" />
                <Input name="randomMix" defaultValue={mixText(s.random_difficulty_mix)} placeholder="Random mix, e.g. 2:3, 3:4" className="h-8 md:col-span-2 md:h-8" />
                <NativeSelect name="practiceQuestionId" defaultValue={s.practice_question_id ?? ""} className="h-8 md:col-span-3 md:h-8">
                  <option value="">No practice question</option>
                  {candidates.map((q) => <option key={q.id} value={q.id}>Practice: {q.stem.slice(0, 60)}</option>)}
                </NativeSelect>
                <Textarea name="instructions" defaultValue={s.instructions ?? ""} rows={2} placeholder="Instructions shown before the section" className="min-h-8 md:col-span-6" />
              </ActionForm>
              {s.selection === "fixed" ? (
                <ActionForm action={saveSectionQuestions} label="Save question list" size="xs" className="mt-3 space-y-1 border-t border-border pt-3">
                  {hidden}<input type="hidden" name="sectionId" value={s.id} />
                  <p className="text-xs text-muted-foreground">{picked.size} chosen. Ticked order is the order asked. Only active questions can be in an active template.</p>
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {candidates.map((q) => {
                      const bank = Array.isArray(q.question_banks) ? q.question_banks[0] : q.question_banks;
                      return (
                        <label key={q.id} className="flex items-start gap-2 text-sm">
                          <input type="checkbox" name="questionIds" value={q.id} defaultChecked={picked.has(q.id)} className="mt-1" />
                          <span>
                            <span className="line-clamp-1">{q.stem}</span>
                            <span className="text-xs text-muted-foreground">{QUESTION_TYPE_LABELS[q.type]} · difficulty {q.difficulty} · {q.marks} marks · {(bank as { name: string } | null)?.name}{q.status !== "active" ? " · DRAFT" : ""}</span>
                          </span>
                        </label>
                      );
                    })}
                    {!candidates.length ? <p className="text-xs text-muted-foreground">No questions in this subject yet.</p> : null}
                  </div>
                </ActionForm>
              ) : (
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                  Random: at launch, {s.random_count ?? "?"} active questions in this subject whose grade band contains the child&apos;s grade are drawn{s.random_difficulty_mix ? `, by difficulty ${mixText(s.random_difficulty_mix)}` : ", across difficulties"}.
                </p>
              )}
              <ActionForm action={deleteSection} label="Remove section" size="xs" variant="ghost" className="mt-2" confirm="Remove this section?">{hidden}<input type="hidden" name="sectionId" value={s.id} /></ActionForm>
            </div>
          );
        })}
        <ActionForm action={saveSection} label="Add section" size="sm" className="grid gap-2 rounded-xl border border-dashed border-border p-4 md:grid-cols-6">
          {hidden}
          <Input name="position" type="number" min={1} defaultValue={(sections?.length ?? 0) + 1} className="h-8 md:h-8" title="Position" />
          <Input name="title" placeholder="Section title, e.g. Reading" className="h-8 md:col-span-2 md:h-8" required />
          <NativeSelect name="subjectId" className="h-8 md:h-8">{(subjects ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect>
          <NativeSelect name="selection" defaultValue="fixed" className="h-8 md:h-8"><option value="fixed">Fixed list</option><option value="random">Random draw</option></NativeSelect>
          <Input name="randomCount" type="number" min={1} placeholder="Random: how many" className="h-8 md:h-8" />
        </ActionForm>
      </div>
    </>
  );
}
