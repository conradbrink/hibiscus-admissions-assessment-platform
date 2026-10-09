import { ApplicantActionButton } from "@/components/applicant/action-button";
import { AnswerBox } from "@/components/applicant/answer-box";
import { IntegrityNotice } from "@/components/applicant/integrity-notice";
import { SectionShell } from "@/components/applicant/section-shell";
import { loadDraftView } from "@/lib/applicant/load-section";
import { getHrSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { finishQuestionsAction } from "../actions";

export default async function QuestionsPage() {
  const view = await loadDraftView();
  const settings = await getHrSettings(createAdminClient());
  const accepted = !!view.application.integrity_notice_accepted_at;
  const answers = new Map(view.answers.map((a) => [a.vacancy_question_id, a.answer_text]));
  return (
    <SectionShell
      title="Questions"
      lead={`${view.questions.length} questions about how you teach. Answer from your own experience, with real examples. Each answer saves as you type, so you can stop and come back.`}
    >
      <IntegrityNotice notice={settings.integrityNotice} accepted={accepted} />
      <ol className="mt-10 space-y-10">
        {view.questions.map((q, i) => (
          <li key={q.id}>
            <AnswerBox questionId={q.id} index={i + 1} prompt={q.prompt} wordLimit={q.word_limit} initial={answers.get(q.id) ?? ""} disabled={!accepted} />
          </li>
        ))}
      </ol>
      {accepted ? (
        <div className="mt-10 border-t border-border pt-6">
          <div className="sm:w-72">
          <ApplicantActionButton action={finishQuestionsAction} label="I have answered every question" pendingLabel="Checking…" />
          </div>
        </div>
      ) : null}
    </SectionShell>
  );
}
