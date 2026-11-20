"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaffAction } from "@/lib/staff/session";
import { storesGuarded, text, type StoresActionState } from "@/lib/stores/server";
import { storesErrorMessage } from "@/lib/stores/rules";

const employeeFields = z.object({
  fullName: z.string().trim().min(2, "Enter the employee's full name.").max(120),
  departmentId: z.guid("Choose a department."),
});

function parseEmployee(formData: FormData) {
  const r = employeeFields.safeParse({ fullName: formData.get("fullName"), departmentId: formData.get("departmentId") });
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? "Check the form.");
  return r.data;
}

/**
 * Adds a person to the directory: the storekeeper does this at the hatch,
 * mid-checkout, so it needs `stores.write` only. An employee is a name and a
 * department, never an account.
 */
export async function addEmployee(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const f = parseEmployee(formData);
    const { data, error } = await ctx.supabase
      .from("stores_employees")
      .insert({
        full_name: f.fullName,
        department_id: f.departmentId,
        employee_number: text(formData.get("employeeNumber"), 40),
        campus_id: (String(formData.get("campusId") ?? "") || null) as string | null,
        contact_details: text(formData.get("contactDetails"), 200),
        created_by: ctx.userId,
      })
      .select("id, full_name, department_id, employee_number, stores_departments!stores_employees_department_id_fkey(name)")
      .single();
    if (error) throw new Error(storesErrorMessage(error));
    const dept = Array.isArray(data.stores_departments) ? data.stores_departments[0] : data.stores_departments;
    revalidatePath("/staff/stores/settings/employees");
    return {
      id: data.id,
      message: `${data.full_name} is in the directory.`,
      employee: { id: data.id, full_name: data.full_name, department_id: data.department_id, department_name: dept?.name ?? "", employee_number: data.employee_number },
    };
  });
}

/** Corrects a name, a department or a number, or switches a person off. Their history keeps the name it was recorded under. */
export async function updateEmployee(_: StoresActionState, formData: FormData): Promise<StoresActionState> {
  return storesGuarded(async () => {
    const ctx = await requireStaffAction("stores.write");
    const id = z.guid().parse(formData.get("id"));
    const f = parseEmployee(formData);
    const { data, error } = await ctx.supabase
      .from("stores_employees")
      .update({
        full_name: f.fullName,
        department_id: f.departmentId,
        employee_number: text(formData.get("employeeNumber"), 40),
        campus_id: (String(formData.get("campusId") ?? "") || null) as string | null,
        contact_details: text(formData.get("contactDetails"), 200),
        is_active: formData.get("isActive") === "on",
      })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(storesErrorMessage(error));
    if (!data) throw new Error("That employee was not found.");
    revalidatePath("/staff/stores/settings/employees");
    return { id, message: "Saved." };
  });
}
