import { notFound } from "next/navigation";
import { ActionForm } from "@/components/staff/action-form";
import { Field } from "@/components/staff/field";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL } from "@/lib/disciplinary";
import { requireStaff } from "@/lib/staff/session";
import { openCaseAction } from "../actions";

export const metadata = { title: "Open a case" };

export default async function NewCasePage({ searchParams }: { searchParams: Promise<{ employee?: string }> }) {
  const ctx = await requireStaff("hr.disciplinary.write");
  const employeeId = (await searchParams).employee ?? "";
  const { data: e } = /^[0-9a-f-]{36}$/.test(employeeId) ? await ctx.supabase.from("hr_employees").select("id, first_name, last_name").eq("id", employeeId).maybeSingle() : { data: null };
  if (!e) notFound();
  return (
    <>
      <PageTitle
        title={`Open a case for ${e.first_name} ${e.last_name}`}
        description="Write down the facts as they are known now. Hearings, evidence and the outcome are added to the case later, in order."
        back={{ href: `/staff/employees/${e.id}#discipline`, label: `${e.first_name} ${e.last_name}` }}
      />
      <ActionForm action={openCaseAction} label="Open case" size="lg" resetOnSubmit={false} className="surface max-w-3xl space-y-5 p-6">
        <input type="hidden" name="employee_id" value={e.id} />
        <Field label="What kind of matter" htmlFor="category">
          <NativeSelect id="category" name="category" defaultValue="misconduct">
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="In a few words" htmlFor="summary" hint="This is the case's name, for example: Late for class on five days in May.">
          <Input id="summary" name="summary" required maxLength={300} />
        </Field>
        <Field label="What happened (optional)" htmlFor="details" hint="Dates, who was there, what was said. Facts, not opinions.">
          <Textarea id="details" name="details" rows={6} />
        </Field>
      </ActionForm>
    </>
  );
}
