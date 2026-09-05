import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { isMedicalPath } from "@/lib/enrolment/export";
import { requireStaff } from "@/lib/staff/session";
import { deleteColumn, saveColumn } from "./actions";

const TRANSFORMS = ["none", "upper", "date_dmy", "date_ymd", "yes_no", "money"] as const;

/** The columns of the student export: a header, a path into the enrolment snapshot, a transform. */
export default async function ExportColumnsPage() {
  const { supabase } = await requireStaff("settings.write");
  const { data: columns } = await supabase.from("export_columns").select("*").order("position");
  const form = (c: NonNullable<typeof columns>[number] | null) => (
    <ActionForm key={c?.id ?? "new"} action={saveColumn} label={c ? "Save" : "Add"} size="sm" variant={c ? "outline" : "default"} className="grid gap-2 rounded-xl border border-border bg-card p-3 md:grid-cols-[70px_1fr_1fr_120px_auto_auto]">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <Input name="position" type="number" defaultValue={c?.position ?? 1000} className="h-8 md:h-8" />
      <Input name="header" defaultValue={c?.header ?? ""} placeholder="Column header" required className="h-8 md:h-8" />
      <Input name="sourcePath" defaultValue={c?.source_path ?? ""} placeholder="student.legal_first_name" required className="h-8 font-mono text-xs md:h-8" pattern="[a-z_]+(\[[0-9]+\])?(\.[a-z_]+(\[[0-9]+\])?)*" />
      <NativeSelect name="transform" defaultValue={c?.transform ?? "none"} className="h-8 md:h-8">{TRANSFORMS.map((t) => <option key={t} value={t}>{t}</option>)}</NativeSelect>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="isActive" value="1" defaultChecked={c ? c.is_active : true} /> active{c && isMedicalPath(c.source_path) ? <span className="ml-1 text-warning-foreground">medical</span> : null}</label>
    </ActionForm>
  );
  return (
    <>
      <PageTitle title="Export columns" description="What each row of the student export contains, in order. A path names a field of the enrolment record: student.date_of_birth, guardians[0].mobile, application.grade. Medical fields are off unless you turn them on." />
      <div className="space-y-2">
        {(columns ?? []).map((c) => (
          <div key={c.id} className="flex items-start gap-2">
            <div className="flex-1">{form(c)}</div>
            <ActionForm action={deleteColumn} label="Remove" size="xs" variant="ghost" className="pt-3" confirm="Remove this column from the export?">
              <input type="hidden" name="id" value={c.id} />
            </ActionForm>
          </div>
        ))}
        <h2 className="pt-2 text-sm font-semibold">Add a column</h2>
        {form(null)}
      </div>
      <details className="mt-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Fields available</summary>
        <p className="mt-1 font-mono">application.reference · application.campus · application.campus_code · application.grade · application.intake · application.start_date · student.legal_first_name · student.legal_middle_names · student.legal_last_name · student.preferred_name · student.gender · student.date_of_birth · student.nationality · student.country_of_birth · student.place_of_birth · student.home_language · student.identity_type · student.identity_number · student.previous_institution · student.current_grade · guardians[n].first_name / last_name / relationship / email / mobile / phone / address / nationality · emergency_contacts[n].first_name / last_name / relationship / phone / email / address · medical.medical_aid_name / medical_aid_number / medical_aid_principal_member / emergency_treatment_consent / allergies / medical_conditions / medication / medical_notes / vaccination_notes · payment.currency / amount_minor / paid_at</p>
      </details>
    </>
  );
}
