import { RowsEditor, type FieldDef } from "@/components/applicant/rows-editor";
import { SectionShell } from "@/components/applicant/section-shell";
import { loadDraftView } from "@/lib/applicant/load-section";
import { getHrSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveRefereesAction } from "../actions";

const FIELDS: FieldDef[] = [
  { name: "full_name", label: "Name", type: "text", half: true },
  {
    name: "relationship",
    label: "How they know you",
    type: "select",
    half: true,
    options: [
      ["principal", "Principal or head of school"],
      ["line_manager", "Line manager or head of department"],
      ["colleague", "Colleague"],
      ["other", "Other"],
    ],
  },
  { name: "organisation", label: "Where they work", type: "text", half: true },
  { name: "role_title", label: "Their job title", type: "text", half: true },
  { name: "email", label: "Email", type: "email", half: true, hint: "We send the reference form here." },
  { name: "phone", label: "Phone (optional)", type: "tel", half: true },
  { name: "is_most_recent_employer", label: "This person is from my most recent employer", type: "checkbox" },
];

export default async function ReferencesPage() {
  const view = await loadDraftView();
  const settings = await getHrSettings(createAdminClient());
  return (
    <SectionShell
      title="References"
      lead={`Give ${settings.minReferees} or ${settings.maxReferees} people who know your work. One must be from your most recent employer, such as your principal or line manager. When you send your application, we email each of them a short form. It takes them about four minutes, and you will not see their answers.`}
    >
      <RowsEditor
        action={saveRefereesAction}
        fields={FIELDS}
        initial={view.referees.map((r) => ({
          full_name: r.full_name,
          relationship: r.relationship,
          organisation: r.organisation,
          role_title: r.role_title ?? "",
          email: r.email,
          phone: r.phone ?? "",
          is_most_recent_employer: r.is_most_recent_employer,
        }))}
        blank={{ full_name: "", relationship: "", organisation: "", role_title: "", email: "", phone: "", is_most_recent_employer: false }}
        itemLabel="Referee"
        addLabel="Add a referee"
        min={settings.minReferees}
        max={settings.maxReferees}
        intro={<p className="rounded-xl bg-muted px-5 py-4 text-[15px]">Please tell your referees to expect an email from Hibiscus International Schools Human Resources.</p>}
      />
    </SectionShell>
  );
}
