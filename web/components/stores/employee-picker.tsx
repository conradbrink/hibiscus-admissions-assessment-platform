"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Picker } from "@/components/stores/picker";
import { useStoresAction } from "@/components/stores/use-stores-action";
import { addEmployee } from "@/app/staff/(stores)/stores/settings/employees/actions";
import type { EmployeeChoice } from "@/lib/stores/data";

/**
 * Who is at the hatch. A search over the directory, and if they are not in
 * it, three fields to add them without leaving the checkout. An employee is a
 * name and a department, never an account: nothing here signs them in or
 * sends them anything.
 */
export function EmployeePicker({
  employees,
  departments,
  value,
  onChange,
  invalid,
  label = "Employee",
}: {
  employees: EmployeeChoice[];
  departments: Array<{ id: string; name: string }>;
  value: string | null;
  onChange: (id: string | null, employee: EmployeeChoice | null) => void;
  invalid?: boolean;
  label?: string;
}) {
  const [list, setList] = useState(employees);
  const [adding, setAdding] = useState(false);
  const { state, pending, onSubmit } = useStoresAction(addEmployee);
  const added = (result: { employee?: Omit<EmployeeChoice, "is_active"> }) => {
    if (!result.employee) return;
    const e: EmployeeChoice = { ...result.employee, is_active: true };
    setList((l) => [...l.filter((x) => x.id !== e.id), e].sort((a, b) => a.full_name.localeCompare(b.full_name)));
    onChange(e.id, e);
    setAdding(false);
  };

  if (adding) {
    return (
      <form onSubmit={onSubmit(added)} className="space-y-3 rounded-xl border border-dashed border-input p-3 sm:p-4">
        <p className="text-sm font-medium">Add an employee to the directory</p>
        <div className="space-y-1.5">
          <Label htmlFor="emp-name">Full name</Label>
          <Input id="emp-name" name="fullName" required maxLength={120} autoFocus autoComplete="off" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="emp-dept">Department</Label>
            <NativeSelect id="emp-dept" name="departmentId" defaultValue="" required>
              <option value="" disabled>Choose</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emp-number">Employee number (optional)</Label>
            <Input id="emp-number" name="employeeNumber" maxLength={40} autoComplete="off" />
          </div>
        </div>
        {state.error ? <p className="text-sm text-destructive" role="alert">{state.error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="h-12 text-base sm:h-9 sm:text-sm" onClick={() => setAdding(false)}>Cancel</Button>
          <Button type="submit" className="h-12 text-base sm:h-9 sm:text-sm" disabled={pending}>{pending ? "Adding…" : "Add and choose"}</Button>
        </div>
      </form>
    );
  }

  return (
    <Picker
      label={label}
      placeholder="Search by name, department or number"
      value={value}
      invalid={invalid}
      onChange={(id) => onChange(id, list.find((e) => e.id === id) ?? null)}
      options={list.map((e) => ({ id: e.id, label: e.full_name, detail: [e.department_name, e.employee_number].filter(Boolean).join(" · "), keywords: `${e.department_name} ${e.employee_number ?? ""}` }))}
      emptyText="Nobody by that name. Add them below."
      footer={
        <button type="button" onClick={() => setAdding(true)} className="flex min-h-12 w-full items-center gap-2 px-4 text-left text-sm font-medium text-primary hover:bg-muted">
          <UserPlus className="size-4" aria-hidden /> Add a new employee
        </button>
      }
    />
  );
}
