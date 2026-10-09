import { notFound } from "next/navigation";
import { PageTitle } from "@/components/staff/page-title";
import { QuestionEditor } from "@/components/recruitment/question-editor";
import { can } from "@/lib/permissions";
import { parseRubric } from "@/lib/questions/rubric";
import { requireStaff } from "@/lib/staff/session";
import { approveQuestionsAction, deleteQuestionAction, draftQuestionsAction, moveQuestionAction, saveQuestionAction } from "../../../actions";

export default async function VacancyQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("hr.recruitment.read");
  const { data: v } = await ctx.supabase.from("hr_vacancies").select("id, title, status, phase").eq("id", id).maybeSingle();
  if (!v) notFound();
  const { data: questions } = await ctx.supabase.from("hr_vacancy_questions").select("*").eq("vacancy_id", v.id).order("sort_order");
  const locked = v.status !== "draft" || !can(ctx.permissions, "hr.questions.write");
  return (
    <>
      <PageTitle
        title="Interview questions"
        description={`${v.title}. Applicants answer these in writing. Every question needs a person's approval, and at least one must be about safeguarding.`}
        back={{ href: `/staff/recruitment/vacancies/${v.id}`, label: "Back to the vacancy" }}
      />
      <QuestionEditor
        locked={locked}
        questions={(questions ?? []).map((q) => ({
          id: q.id,
          prompt: q.prompt,
          competency: q.competency,
          word_limit: q.word_limit,
          origin: q.origin,
          status: q.status,
          ai_rationale: q.ai_rationale,
          bands: parseRubric(q.rubric)?.bands ?? [],
        }))}
        actions={{
          draft: draftQuestionsAction.bind(null, v.id),
          save: saveQuestionAction.bind(null, v.id),
          approve: approveQuestionsAction.bind(null, v.id),
          remove: deleteQuestionAction.bind(null, v.id),
          move: moveQuestionAction.bind(null, v.id),
        }}
      />
    </>
  );
}
