import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { createAcademicYear, createIntake, setIntakeOpen } from "./actions";

export default async function IntakesPage() {
  const { supabase } = await requireStaff("settings.write");
  const [{ data: years }, { data: intakes }] = await Promise.all([
    supabase.from("academic_years").select("*").order("starts_on"),
    supabase.from("intakes").select("*").order("starts_on"),
  ]);

  return (
    <>
      <PageTitle title="Academic years and intakes" description="Parents choose an open intake. The year's cut-off date is what the grade recommendation uses." />
      <div className="space-y-4">
        {(years ?? []).map((y) => (
          <section key={y.id} className="rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">
              {y.label} <span className="font-normal text-muted-foreground">· {formatDate(y.starts_on)} – {formatDate(y.ends_on)} · age cut-off {formatDate(y.age_cutoff_on)}</span>
            </h2>
            <ul className="mt-2 divide-y divide-border text-sm">
              {(intakes ?? []).filter((i) => i.academic_year_id === y.id).map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-2">
                  <span className="flex-1">{i.label} <span className="text-muted-foreground">· starts {formatDate(i.starts_on)}</span></span>
                  {i.is_open ? <Badge variant="success">Open</Badge> : <Badge variant="muted">Closed</Badge>}
                  <ActionForm action={setIntakeOpen} label={i.is_open ? "Close" : "Open"} size="xs" variant="outline">
                    <input type="hidden" name="intakeId" value={i.id} />
                    <input type="hidden" name="open" value={i.is_open ? "0" : "1"} />
                  </ActionForm>
                </li>
              ))}
            </ul>
            <ActionForm action={createIntake} label="Add term" size="xs" variant="outline" className="mt-2 grid grid-cols-[80px_1fr_150px_auto] items-end gap-2">
              <input type="hidden" name="academicYearId" value={y.id} />
              <NativeSelect name="term" defaultValue="1"><option value="1">Term 1</option><option value="2">Term 2</option><option value="3">Term 3</option></NativeSelect>
              <Input name="label" placeholder={`Term 1, ${y.label}`} required />
              <Input name="startsOn" type="date" required />
            </ActionForm>
          </section>
        ))}
      </div>
      <section className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Add an academic year</h2>
        <ActionForm action={createAcademicYear} label="Add year" size="sm" className="grid gap-2 sm:grid-cols-4">
          <Input name="label" placeholder="2028" required />
          <Input name="startsOn" type="date" required />
          <Input name="endsOn" type="date" required />
          <Input name="ageCutoffOn" type="date" required />
        </ActionForm>
        <p className="mt-1 text-xs text-muted-foreground">Order: label, first day, last day, age cut-off (31 July of that year).</p>
      </section>
    </>
  );
}
