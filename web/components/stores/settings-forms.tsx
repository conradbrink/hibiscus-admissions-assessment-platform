"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useStoresAction } from "@/components/stores/use-stores-action";
import { inviteStoresUser, reactivateItem, saveNamed, setStoresRole } from "@/app/staff/(stores)/stores/settings/actions";
import { updateEmployee, addEmployee } from "@/app/staff/(stores)/stores/settings/employees/actions";
import type { StoresActionState } from "@/lib/stores/server";

function Feedback({ state }: { state: StoresActionState }) {
  if (state.error) return <p className="text-sm text-destructive" role="alert">{state.error}</p>;
  if (state.ok && state.message) return <p className="text-sm text-success" role="status">{state.message}</p>;
  return null;
}

/** One row of a departments, categories or locations list: rename, or switch off. */
export function NamedRow({ list, id, name, isActive }: { list: string; id: string; name: string; isActive: boolean }) {
  const router = useRouter();
  const { state, pending, onSubmit } = useStoresAction(saveNamed);
  return (
    <form onSubmit={onSubmit(() => router.refresh())} className="surface grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <input type="hidden" name="list" value={list} />
      <input type="hidden" name="id" value={id} />
      <Input name="name" defaultValue={name} maxLength={80} aria-label="Name" required />
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={isActive} className="size-5 accent-[var(--primary)]" /> In use
      </label>
      <Button type="submit" variant="outline" className="h-11 md:h-9" disabled={pending}>{pending ? "…" : "Save"}</Button>
      <div className="sm:col-span-3"><Feedback state={state} /></div>
    </form>
  );
}

export function NamedAdd({ list, placeholder }: { list: string; placeholder: string }) {
  const router = useRouter();
  const [key, setKey] = useState(0);
  const { state, pending, onSubmit } = useStoresAction(saveNamed);
  return (
    <form key={key} onSubmit={onSubmit(() => { setKey((k) => k + 1); router.refresh(); })} className="surface grid gap-2 p-3 sm:grid-cols-[1fr_auto]">
      <input type="hidden" name="list" value={list} />
      <Input name="name" placeholder={placeholder} maxLength={80} aria-label="New name" required />
      <Button type="submit" className="h-11 md:h-9" disabled={pending}>{pending ? "Adding…" : "Add"}</Button>
      <div className="sm:col-span-2"><Feedback state={state} /></div>
    </form>
  );
}

export function EmployeeEditor({
  employee,
  departments,
  campuses,
}: {
  employee?: { id: string; full_name: string; department_id: string; employee_number: string | null; campus_id: string | null; contact_details: string | null; is_active: boolean };
  departments: Array<{ id: string; name: string }>;
  campuses: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [key, setKey] = useState(0);
  const { state, pending, onSubmit } = useStoresAction(employee ? updateEmployee : addEmployee);
  const p = employee ? `emp-${employee.id}` : "emp-new";
  return (
    <form key={key} onSubmit={onSubmit(() => { if (!employee) setKey((k) => k + 1); router.refresh(); })} className="grid gap-3 sm:grid-cols-2">
      {employee ? <input type="hidden" name="id" value={employee.id} /> : null}
      <div className="space-y-1.5"><Label htmlFor={`${p}-name`}>Full name</Label><Input id={`${p}-name`} name="fullName" defaultValue={employee?.full_name ?? ""} maxLength={120} required /></div>
      <div className="space-y-1.5">
        <Label htmlFor={`${p}-dept`}>Department</Label>
        <NativeSelect id={`${p}-dept`} name="departmentId" defaultValue={employee?.department_id ?? ""} required>
          <option value="" disabled>Choose</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${p}-campus`}>Campus (optional)</Label>
        <NativeSelect id={`${p}-campus`} name="campusId" defaultValue={employee?.campus_id ?? ""}>
          <option value="">None</option>
          {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </div>
      <div className="space-y-1.5"><Label htmlFor={`${p}-number`}>Employee number (optional)</Label><Input id={`${p}-number`} name="employeeNumber" defaultValue={employee?.employee_number ?? ""} maxLength={40} /></div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${p}-contact`}>Contact details, for the school&apos;s records only (optional)</Label>
        <Input id={`${p}-contact`} name="contactDetails" defaultValue={employee?.contact_details ?? ""} maxLength={200} />
        <p className="text-xs text-muted-foreground">Stores never sends anything to an employee.</p>
      </div>
      {employee ? (
        <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="isActive" defaultChecked={employee.is_active} className="size-5 accent-[var(--primary)]" /> Active: may collect stock
        </label>
      ) : null}
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" className="h-11 md:h-9" disabled={pending}>{pending ? "Saving…" : employee ? "Save" : "Add employee"}</Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function RoleToggle({ staffId, role, granted, label }: { staffId: string; role: "storekeeper" | "stores_admin"; granted: boolean; label: string }) {
  const router = useRouter();
  const { state, pending, onSubmit } = useStoresAction(setStoresRole);
  return (
    <form onSubmit={onSubmit(() => router.refresh())} className="inline-flex flex-col gap-1">
      <input type="hidden" name="staffId" value={staffId} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="granted" value={granted ? "0" : "1"} />
      <Button type="submit" size="sm" variant={granted ? "destructive" : "outline"} className="h-10 md:h-8" disabled={pending}>
        {pending ? "…" : granted ? `Remove ${label}` : `Make ${label}`}
      </Button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}

export function InviteForm() {
  const router = useRouter();
  const [key, setKey] = useState(0);
  const { state, pending, onSubmit } = useStoresAction(inviteStoresUser);
  return (
    <form key={key} onSubmit={onSubmit(() => { setKey((k) => k + 1); router.refresh(); })} className="grid gap-3 sm:grid-cols-[1fr_1fr_14rem_auto] sm:items-end">
      <div className="space-y-1.5"><Label htmlFor="inv-name">Full name</Label><Input id="inv-name" name="fullName" required maxLength={120} /></div>
      <div className="space-y-1.5"><Label htmlFor="inv-email">Email</Label><Input id="inv-email" name="email" type="email" required /></div>
      <div className="space-y-1.5">
        <Label htmlFor="inv-role">Role</Label>
        <NativeSelect id="inv-role" name="role" defaultValue="storekeeper">
          <option value="storekeeper">Purchasing Officer / Storekeeper</option>
          <option value="stores_admin">Stores administrator</option>
        </NativeSelect>
      </div>
      <Button type="submit" className="h-11 md:h-9" disabled={pending}>{pending ? "Sending…" : "Send invitation"}</Button>
      <div className="sm:col-span-4"><Feedback state={state} /></div>
    </form>
  );
}

export function ReactivateButton({ id }: { id: string }) {
  const router = useRouter();
  const { state, pending, onSubmit } = useStoresAction(reactivateItem);
  return (
    <form onSubmit={onSubmit(() => router.refresh())} className="inline-flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="outline" className="h-10 md:h-8" disabled={pending}>{pending ? "…" : "Switch on"}</Button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}
