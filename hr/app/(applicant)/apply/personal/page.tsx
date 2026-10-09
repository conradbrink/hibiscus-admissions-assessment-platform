import { PersonalForm } from "@/components/applicant/personal-form";
import { SectionShell } from "@/components/applicant/section-shell";
import { loadDraftView } from "@/lib/applicant/load-section";

export default async function PersonalPage() {
  const view = await loadDraftView();
  const a = view.application;
  return (
    <SectionShell title="About you" lead="How we can reach you about this application.">
      <PersonalForm
        initial={{
          first_name: a.first_name,
          last_name: a.last_name,
          phone: a.phone ?? "",
          nationality: a.nationality ?? "",
          is_citizen: a.is_citizen === null ? "" : a.is_citizen ? "yes" : "no",
        }}
        email={a.email}
        country={view.campus.country === "ZA" ? "South Africa" : "Botswana"}
      />
    </SectionShell>
  );
}
