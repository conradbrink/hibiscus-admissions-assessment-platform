import { RowsEditor, type FieldDef } from "@/components/applicant/rows-editor";
import { SectionShell } from "@/components/applicant/section-shell";
import { loadDraftView } from "@/lib/applicant/load-section";
import { saveEmploymentAction } from "../actions";

const FIELDS: FieldDef[] = [
  { name: "employer", label: "Employer", type: "text", half: true, placeholder: "Name of the school or organisation" },
  { name: "role_title", label: "Your job title", type: "text", half: true, placeholder: "Grade 3 class teacher" },
  { name: "start_on", label: "Started", type: "date", half: true },
  { name: "end_on", label: "Finished", type: "date", half: true, hint: "Leave empty if you still work here." },
  { name: "phase_taught", label: "Phase or subject you taught", type: "text", placeholder: "Pre-school, Foundation Phase, Secondary Maths…" },
  { name: "is_school", label: "This was at a school, pre-school or college", type: "checkbox" },
  { name: "reason_for_leaving", label: "Why you left (or are leaving)", type: "textarea", maxLength: 500 },
];

export default async function CareerPage() {
  const view = await loadDraftView();
  return (
    <SectionShell
      title="Career history"
      lead="List your jobs, starting with the most recent. We use the dates to see how long you stayed in each post. If you are newly qualified, you can save this section with no jobs."
    >
      <RowsEditor
        action={saveEmploymentAction}
        fields={FIELDS}
        initial={view.employment.map((j) => ({
          employer: j.employer,
          role_title: j.role_title,
          start_on: j.start_on,
          end_on: j.end_on ?? "",
          phase_taught: j.phase_taught ?? "",
          is_school: j.is_school,
          reason_for_leaving: j.reason_for_leaving ?? "",
        }))}
        blank={{ employer: "", role_title: "", start_on: "", end_on: "", phase_taught: "", is_school: true, reason_for_leaving: "" }}
        itemLabel="Job"
        addLabel="Add a job"
        min={0}
        max={15}
      />
    </SectionShell>
  );
}
