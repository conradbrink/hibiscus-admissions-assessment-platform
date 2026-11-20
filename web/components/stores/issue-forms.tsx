"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HandHelping, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EmployeePicker } from "@/components/stores/employee-picker";
import { Picker } from "@/components/stores/picker";
import { QuantityStepper } from "@/components/stores/quantity-stepper";
import { assignAsset, issueConsumables } from "@/app/staff/(stores)/stores/issues/actions";
import type { EmployeeChoice, ItemChoice } from "@/lib/stores/data";
import { NO_ANSWER } from "@/lib/stores/offline";
import { newRequestId } from "@/lib/stores/request-id";
import { ITEM_TYPE_LABELS, quantityLine } from "@/lib/stores/rules";

type Line = { itemId: string; quantity: number };
const sticky = "fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0";

/**
 * Issue consumables: who received them, what and how many. Deducted on
 * Confirm, with the department and the storekeeper's name; nothing comes
 * back, so there is no return date and no signature.
 */
export function IssueForm({
  employees,
  departments,
  items,
  initialItemId,
}: {
  employees: EmployeeChoice[];
  departments: Array<{ id: string; name: string }>;
  items: ItemChoice[];
  initialItemId: string | null;
}) {
  const router = useRouter();
  const [employee, setEmployee] = useState<EmployeeChoice | null>(null);
  const start = items.find((i) => i.id === initialItemId && i.qty_available > 0);
  const [lines, setLines] = useState<Line[]>(start ? [{ itemId: start.id, quantity: 1 }] : []);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Kept across a refusal, so a retry of the same issue is the same request.
  const [requestId, setRequestId] = useState(newRequestId);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const chosen = new Set(lines.map((l) => l.itemId));

  const edit = (fn: (ls: Line[]) => Line[]) => {
    setLines(fn);
    setRequestId(newRequestId());
  };

  const submit = () => {
    if (!employee) return setError("Choose the employee who is receiving the goods.");
    if (!lines.length) return setError("Add at least one item.");
    const over = lines.find((l) => l.quantity > (byId.get(l.itemId)?.qty_available ?? 0));
    if (over) return setError(`Only ${byId.get(over.itemId)?.qty_available} of ${byId.get(over.itemId)?.name} in stock.`);
    setError(null);
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof issueConsumables>>;
      try {
        r = await issueConsumables({ requestId, employeeId: employee.id, lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })), notes });
      } catch {
        // Same request id on the next press, so a recorded issue replays.
        return setError(NO_ANSWER);
      }
      if (r.error || !r.id) return setError(r.error ?? "The issue was not saved. Try again.");
      router.replace(`/staff/stores/transactions/issue/${r.id}?done=1`);
    });
  };

  return (
    <div className="space-y-4 pb-24 md:pb-4">
      <section className="surface space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold">1. Received by</h2>
        <EmployeePicker employees={employees} departments={departments} value={employee?.id ?? null} onChange={(_, e) => { setEmployee(e); setRequestId(newRequestId()); }} label="Received by" />
        {employee ? <p className="text-xs text-muted-foreground">Recorded against the {employee.department_name} department.</p> : null}
      </section>
      <section className="surface space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold">2. Consumables</h2>
        {lines.length ? (
          <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
            {lines.map((l) => {
              const i = byId.get(l.itemId);
              if (!i) return null;
              return (
                <li key={l.itemId} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-medium md:text-sm">{i.name}</p>
                    <p className="text-xs text-muted-foreground">{i.qty_available} {i.unit} in stock</p>
                  </div>
                  <QuantityStepper size="sm" value={l.quantity} min={1} max={i.qty_available} label={`Quantity of ${i.name}`} onChange={(n) => edit((ls) => ls.map((x) => (x.itemId === l.itemId ? { ...x, quantity: n } : x)))} />
                  <button type="button" aria-label={`Remove ${i.name}`} onClick={() => edit((ls) => ls.filter((x) => x.itemId !== l.itemId))} className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive">
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <Picker
          label="Add a consumable"
          placeholder={lines.length ? "Add another item" : "Search for the consumable"}
          value={null}
          onChange={(id) => { if (id && !chosen.has(id)) edit((ls) => [...ls, { itemId: id, quantity: 1 }]); }}
          options={items.filter((i) => !chosen.has(i.id)).map((i) => ({ id: i.id, label: i.name, detail: `${i.qty_available} ${i.unit} in stock`, keywords: i.category_name, image: i.photo_url, disabled: i.qty_available < 1, disabledReason: i.qty_available < 1 ? "Out of stock" : undefined }))}
          emptyText="No consumable by that name."
        />
      </section>
      <details className="surface p-4 sm:p-5">
        <summary className="cursor-pointer text-sm font-medium">Add a note (optional)</summary>
        <Textarea className="mt-3" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} aria-label="Note" />
      </details>
      {lines.length && employee ? (
        <p className="rounded-xl bg-muted/60 px-4 py-3 text-sm">
          Issuing to <span className="font-semibold">{employee.full_name}</span>: {lines.map((l) => { const i = byId.get(l.itemId)!; return quantityLine(l.quantity, i.name, i.unit); }).join(", ")}.
        </p>
      ) : null}
      {error ? <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className={sticky}>
        <Button type="button" onClick={submit} disabled={pending} className="h-13 w-full text-base font-semibold md:h-11">
          <HandHelping aria-hidden /> {pending ? "Saving…" : "Confirm issue"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Assign an asset for good: to a department, with the person responsible
 * and where it now lives. It leaves the shelf and stays on the register.
 */
export function AssignForm({
  employees,
  departments,
  items,
  initialItemId,
}: {
  employees: EmployeeChoice[];
  departments: Array<{ id: string; name: string }>;
  items: ItemChoice[];
  initialItemId: string | null;
}) {
  const router = useRouter();
  const [itemId, setItemId] = useState<string | null>(items.some((i) => i.id === initialItemId && i.qty_available > 0) ? initialItemId : null);
  const [quantity, setQuantity] = useState(1);
  const [employee, setEmployee] = useState<EmployeeChoice | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);
  const [pending, startTransition] = useTransition();
  const item = items.find((i) => i.id === itemId) ?? null;

  const submit = () => {
    if (!item) return setError("Choose the item being assigned.");
    if (quantity > item.qty_available) return setError(`Only ${item.qty_available} of ${item.name} available.`);
    if (!departmentId && !employee) return setError("Choose the department, or the person responsible, the item is assigned to.");
    setError(null);
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof assignAsset>>;
      try {
        r = await assignAsset({ requestId, itemId: item.id, quantity, departmentId: departmentId || null, employeeId: employee?.id ?? null, locationNote, notes });
      } catch {
        // Keep the request id: the assignment may have been recorded.
        setError(NO_ANSWER);
        return;
      }
      if (r.error || !r.id) {
        setError(r.error ?? "The assignment was not saved. Try again.");
        setRequestId(newRequestId());
        return;
      }
      router.replace(`/staff/stores/transactions/assignment/${r.id}?done=1`);
    });
  };

  return (
    <div className="space-y-4 pb-24 md:pb-4">
      <section className="surface space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold">1. Item</h2>
        <Picker
          label="Item to assign"
          placeholder="Search for the item"
          value={itemId}
          onChange={(id) => { setItemId(id); setQuantity(1); }}
          options={items.map((i) => ({ id: i.id, label: i.name, detail: `${i.qty_available} available · ${ITEM_TYPE_LABELS[i.item_type]}`, keywords: i.category_name, image: i.photo_url, disabled: i.qty_available < 1, disabledReason: i.qty_available < 1 ? "None available" : undefined }))}
          emptyText="No equipment or asset by that name."
        />
        {item ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">How many</span>
            <QuantityStepper value={quantity} min={1} max={item.qty_available} onChange={setQuantity} label={`Quantity of ${item.name}`} />
          </div>
        ) : null}
      </section>
      <section className="surface space-y-4 p-4 sm:p-5">
        <h2 className="text-base font-semibold">2. Assigned to</h2>
        <div className="space-y-1.5">
          <Label>Responsible person (optional)</Label>
          {/* The department is not filled in from the person: left empty it is
              theirs, decided when it is saved, so changing the person changes
              it too. Filling it in kept the first person's department. */}
          <EmployeePicker employees={employees} departments={departments} value={employee?.id ?? null} label="Responsible person" onChange={(_, e) => setEmployee(e)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assign-dept">Department</Label>
          <NativeSelect id="assign-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">{employee ? `${employee.department_name} (the responsible person's)` : "Choose a department"}</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assign-location">Where it now lives (optional)</Label>
          <Input id="assign-location" value={locationNote} onChange={(e) => setLocationNote(e.target.value)} maxLength={160} placeholder="Block 7, Marketing office" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="assign-notes">Note (optional)</Label>
          <Textarea id="assign-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} />
        </div>
      </section>
      {error ? <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{error}</p> : null}
      <div className={sticky}>
        <Button type="button" onClick={submit} disabled={pending || !itemId} className="h-13 w-full text-base font-semibold md:h-11">
          {pending ? "Saving…" : item ? `Assign ${quantity} × ${item.name}` : "Choose an item first"}
        </Button>
      </div>
    </div>
  );
}
