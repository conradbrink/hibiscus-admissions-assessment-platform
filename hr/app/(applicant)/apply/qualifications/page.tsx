import { RowsEditor, type FieldDef } from "@/components/applicant/rows-editor";
import { SectionShell } from "@/components/applicant/section-shell";
import { loadDraftView } from "@/lib/applicant/load-section";
import { saveQualificationsAction } from "../actions";

const FIELDS: FieldDef[] = [
  {
    name: "level",
    label: "Level",
    type: "select",
    half: true,
    options: [
      ["certificate", "Certificate"],
      ["diploma", "Diploma"],
      ["degree", "Degree"],
      ["honours", "Honours degree"],
      ["postgraduate_certificate", "Postgraduate certificate (e.g. PGCE)"],
      ["masters", "Master's degree"],
      ["doctorate", "Doctorate"],
      ["other", "Other"],
    ],
  },
  { name: "year_completed", label: "Year finished", type: "number", half: true, placeholder: "2018" },
  { name: "title", label: "Name of the qualification", type: "text", placeholder: "Bachelor of Education (Foundation Phase)" },
  { name: "institution", label: "Where you studied", type: "text", half: true },
  { name: "country", label: "Country", type: "text", half: true },
  { name: "is_teaching", label: "This is a teaching qualification (for example a B.Ed, a PGCE or an early childhood diploma)", type: "checkbox" },
];

export default async function QualificationsPage() {
  const view = await loadDraftView();
  return (
    <SectionShell title="Qualifications" lead="Add your degrees, diplomas and teaching qualifications, most important first. You do not need to list school results.">
      <RowsEditor
        action={saveQualificationsAction}
        fields={FIELDS}
        initial={view.qualifications.map((q) => ({ level: q.level, year_completed: q.year_completed, title: q.title, institution: q.institution, country: q.country, is_teaching: q.is_teaching }))}
        blank={{ level: "", year_completed: "", title: "", institution: "", country: "", is_teaching: false }}
        itemLabel="Qualification"
        addLabel="Add a qualification"
        min={1}
        max={12}
      />
    </SectionShell>
  );
}
