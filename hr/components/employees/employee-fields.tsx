import { Field } from "@/components/staff/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { HrEmployeeRow } from "@/lib/supabase/types";

/** The fields of an employee's main record, shared by "Add employee" and the profile's edit form. */
export function EmployeeFields({
  initial,
  campuses,
  departments,
}: {
  initial: Partial<HrEmployeeRow>;
  campuses: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Field label="First name" htmlFor="first_name">
        <Input id="first_name" name="first_name" defaultValue={initial.first_name ?? ""} required autoComplete="off" />
      </Field>
      <Field label="Last name" htmlFor="last_name">
        <Input id="last_name" name="last_name" defaultValue={initial.last_name ?? ""} required autoComplete="off" />
      </Field>
      <Field label="Email (optional)" htmlFor="email" hint="Payslips and leave decisions are sent here.">
        <Input id="email" name="email" type="email" defaultValue={initial.email ?? ""} autoComplete="off" />
      </Field>
      <Field label="Phone (optional)" htmlFor="phone">
        <Input id="phone" name="phone" type="tel" defaultValue={initial.phone ?? ""} autoComplete="off" />
      </Field>
      <Field label="Position" htmlFor="position_title">
        <Input id="position_title" name="position_title" defaultValue={initial.position_title ?? ""} placeholder="Grade 3 class teacher" required />
      </Field>
      <Field label="Department (optional)" htmlFor="department_id">
        <NativeSelect id="department_id" name="department_id" defaultValue={initial.department_id ?? ""}>
          <option value="">None</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="School" htmlFor="campus_id">
        <NativeSelect id="campus_id" name="campus_id" defaultValue={initial.campus_id ?? ""} required>
          <option value="">Choose a school</option>
          {campuses.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Type of contract" htmlFor="employment_type">
        <NativeSelect id="employment_type" name="employment_type" defaultValue={initial.employment_type ?? "permanent"}>
          <option value="permanent">Permanent</option>
          <option value="fixed_term">Fixed term</option>
          <option value="part_time">Part time</option>
          <option value="temporary">Temporary</option>
        </NativeSelect>
      </Field>
      <Field label="Start date" htmlFor="start_date">
        <Input id="start_date" name="start_date" type="date" defaultValue={initial.start_date ?? ""} required />
      </Field>
      <Field label="Probation ends (optional)" htmlFor="probation_end_date">
        <Input id="probation_end_date" name="probation_end_date" type="date" defaultValue={initial.probation_end_date ?? ""} />
      </Field>
      <label className="flex items-center gap-2 text-sm md:col-span-2">
        <input type="checkbox" name="is_teaching" defaultChecked={initial.is_teaching ?? true} className="size-4 accent-primary" />
        This person teaches (teacher registration is tracked for them)
      </label>
    </div>
  );
}
