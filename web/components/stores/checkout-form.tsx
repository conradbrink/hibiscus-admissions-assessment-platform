"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, PenLine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AcknowledgementScreen } from "@/components/stores/acknowledgement";
import { EmployeePicker } from "@/components/stores/employee-picker";
import { Picker } from "@/components/stores/picker";
import { QuantityStepper } from "@/components/stores/quantity-stepper";
import { checkoutEquipment } from "@/app/staff/(stores)/stores/check-out/actions";
import { formatDateLong, formatDateTime } from "@/lib/format-date";
import type { EmployeeChoice, ItemChoice } from "@/lib/stores/data";
import { newRequestId } from "@/lib/stores/request-id";
import { nextSchoolDay, quantityLine, quickReturnDates } from "@/lib/stores/rules";
import type { Drawing } from "@/lib/stores/signature";
import { cn } from "@/lib/utils";

type Line = { itemId: string; quantity: number };

/**
 * Check Out Equipment, built to take under thirty seconds before the
 * signature: who, what, when back, then one screen the employee reads and
 * signs. The return date starts on the next school day and is one tap to
 * change; adding an item adds one of it; the employee can be added to the
 * directory without leaving.
 */
export function CheckoutForm({
  employees,
  departments,
  items,
  initialItemId,
  today,
  acknowledgement,
}: {
  employees: EmployeeChoice[];
  departments: Array<{ id: string; name: string }>;
  items: ItemChoice[];
  initialItemId: string | null;
  today: string;
  acknowledgement: string;
}) {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employee, setEmployee] = useState<EmployeeChoice | null>(null);
  const start = items.find((i) => i.id === initialItemId && i.qty_available > 0);
  const [lines, setLines] = useState<Line[]>(start ? [{ itemId: start.id, quantity: 1 }] : []);
  const [expected, setExpected] = useState(nextSchoolDay(today));
  const [notes, setNotes] = useState("");
  const [signing, setSigning] = useState(false);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);
  const [problems, setProblems] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [issuedAt, setIssuedAt] = useState("");

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const chosen = new Set(lines.map((l) => l.itemId));

  const validate = (): string[] => {
    const out: string[] = [];
    if (!employeeId) out.push("Choose the employee who is collecting the equipment.");
    if (!lines.length) out.push("Add at least one item.");
    for (const l of lines) {
      const i = byId.get(l.itemId);
      if (!i) continue;
      if (l.quantity < 1) out.push(`Enter how many of ${i.name}.`);
      if (l.quantity > i.qty_available) out.push(`Only ${i.qty_available} of ${i.name} available.`);
    }
    if (!expected) out.push("Choose the date the equipment is due back.");
    else if (expected < today) out.push("The return date cannot be in the past.");
    return out;
  };

  const review = () => {
    const found = validate();
    setProblems(found);
    if (found.length) return;
    setError(null);
    setDrawing(null);
    setIssuedAt(formatDateTime(new Date()));
    // One request per review. Nothing can change while the employee signs,
    // so a retry from this screen replays safely; going Back to change the
    // checkout makes the next review a new request.
    setRequestId(newRequestId());
    setSigning(true);
  };

  const confirm = () => {
    if (!drawing || !employeeId) return;
    setError(null);
    startTransition(async () => {
      const result = await checkoutEquipment({
        requestId,
        employeeId,
        expectedReturnDate: expected,
        lines: lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity })),
        drawing: JSON.stringify(drawing),
        acknowledgement,
        notes,
      });
      if (result.error || !result.id) {
        setError(result.error ?? "The checkout was not saved. Try again.");
        return;
      }
      router.replace(`/staff/stores/transactions/checkout/${result.id}?done=1`);
    });
  };

  const quick = quickReturnDates(today);
  const totalUnits = lines.reduce((n, l) => n + l.quantity, 0);

  return (
    <>
      <div className="space-y-4 pb-24 md:pb-4">
        <section className="surface space-y-3 p-4 sm:p-5" aria-labelledby="who-heading">
          <h2 id="who-heading" className="text-base font-semibold">1. Who is collecting?</h2>
          <EmployeePicker
            employees={employees}
            departments={departments}
            value={employeeId}
            invalid={problems.length > 0 && !employeeId}
            onChange={(id, e) => {
              setEmployeeId(id);
              setEmployee(e);
            }}
          />
        </section>

        <section className="surface space-y-3 p-4 sm:p-5" aria-labelledby="what-heading">
          <h2 id="what-heading" className="text-base font-semibold">2. Equipment</h2>
          {lines.length ? (
            <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
              {lines.map((l) => {
                const i = byId.get(l.itemId);
                if (!i) return null;
                return (
                  <li key={l.itemId} className="flex flex-wrap items-center gap-3 px-3 py-3">
                    {i.photo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a private, session-checked route
                      <img src={i.photo_url} alt="" className="size-12 shrink-0 rounded-lg border border-border/70 object-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-medium md:text-sm">{i.name}</p>
                      <p className="text-xs text-muted-foreground">{i.qty_available} available</p>
                    </div>
                    <QuantityStepper
                      size="sm"
                      value={l.quantity}
                      min={1}
                      max={i.qty_available}
                      label={`Quantity of ${i.name}`}
                      onChange={(n) => setLines((ls) => ls.map((x) => (x.itemId === l.itemId ? { ...x, quantity: n } : x)))}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${i.name}`}
                      onClick={() => setLines((ls) => ls.filter((x) => x.itemId !== l.itemId))}
                      className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <Picker
            label="Add equipment"
            placeholder={lines.length ? "Add another item" : "Search for the equipment"}
            value={null}
            invalid={problems.length > 0 && !lines.length}
            onChange={(id) => {
              if (id && !chosen.has(id)) setLines((ls) => [...ls, { itemId: id, quantity: 1 }]);
            }}
            options={items
              .filter((i) => !chosen.has(i.id))
              .map((i) => ({
                id: i.id,
                label: i.name,
                detail: `${i.qty_available} available${i.category_name ? ` · ${i.category_name}` : ""}`,
                keywords: i.category_name,
                image: i.photo_url,
                disabled: i.qty_available < 1,
                disabledReason: i.qty_available < 1 ? (i.qty_unavailable > 0 ? `None available: ${i.qty_unavailable} damaged or awaiting repair` : "None available: all on loan") : undefined,
              }))}
            emptyText="No reusable equipment by that name."
          />
        </section>

        <section className="surface space-y-3 p-4 sm:p-5" aria-labelledby="when-heading">
          <h2 id="when-heading" className="text-base font-semibold">3. Due back</h2>
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => setExpected(q.date)}
                aria-pressed={expected === q.date}
                className={cn(
                  "h-11 rounded-xl border px-3.5 text-sm font-medium transition-colors md:h-9",
                  expected === q.date ? "border-primary bg-accent text-accent-foreground" : "border-input bg-card hover:bg-muted"
                )}
              >
                {q.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-56">
              <CalendarClock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input type="date" aria-label="Expected return date" value={expected} min={today} onChange={(e) => setExpected(e.target.value)} className="pl-9" required />
            </div>
            <span className="text-sm text-muted-foreground">{expected ? formatDateLong(expected) : "Choose a date"}</span>
          </div>
        </section>

        <details className="surface p-4 sm:p-5">
          <summary className="cursor-pointer text-sm font-medium">Add a note (optional)</summary>
          <div className="mt-3 space-y-1.5">
            <Label htmlFor="checkout-notes" className="sr-only">Note</Label>
            <Textarea id="checkout-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} placeholder="For the Grade 7 assembly" />
          </div>
        </details>

        {problems.length ? (
          <ul className="space-y-1 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        ) : null}

        {/* Above the phone's bottom bar, always in reach of the thumb. */}
        <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
          <Button type="button" onClick={review} className="h-13 w-full text-base font-semibold md:h-11">
            <PenLine aria-hidden /> Review and sign{totalUnits ? ` · ${totalUnits} ${totalUnits === 1 ? "item" : "items"}` : ""}
          </Button>
        </div>
      </div>

      {signing && employee ? (
        <AcknowledgementScreen
          title="Hibiscus Schools – Equipment Handover Acknowledgement"
          facts={[
            { label: "Employee name", value: employee.full_name },
            { label: "Department", value: employee.department_name || "—" },
            { label: "Date issued", value: issuedAt },
            { label: "Expected return date", value: formatDateLong(expected) },
          ]}
          linesLabel="Equipment issued"
          lines={lines.map((l) => {
            const i = byId.get(l.itemId)!;
            return { key: l.itemId, text: quantityLine(l.quantity, i.name, i.unit) };
          })}
          acknowledgement={acknowledgement}
          onBack={() => setSigning(false)}
          onDrawing={setDrawing}
          onConfirm={confirm}
          confirmLabel="Confirm checkout"
          pending={pending}
          error={error}
          signed={Boolean(drawing)}
        />
      ) : null}
    </>
  );
}
