"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AcknowledgementScreen } from "@/components/stores/acknowledgement";
import { QuantityStepper } from "@/components/stores/quantity-stepper";
import { checkInEquipment } from "@/app/staff/(stores)/stores/check-in/actions";
import { formatDateTime } from "@/lib/format-date";
import { NO_ANSWER } from "@/lib/stores/offline";
import { newRequestId } from "@/lib/stores/request-id";
import { CONDITIONS, CONDITION_LABELS, quantityLine, type Condition } from "@/lib/stores/rules";
import type { Drawing } from "@/lib/stores/signature";
import { cn } from "@/lib/utils";

export type ReturnLine = { lineId: string; itemName: string; unit: string; quantity: number; returned: number; outstanding: number; photoUrl: string | null };
type Entry = { quantity: number; condition: Condition; note: string };

/**
 * Check In: every outstanding item on one checkout, each starting at all of
 * it in good condition, because that is the usual return and it should take
 * one tap to review. A partial return is the minus button; damage is one tap
 * on the condition. Then the employee signs for exactly what is coming back.
 */
export function CheckInForm({
  checkoutId,
  reference,
  employeeName,
  lines,
  acknowledgement,
}: {
  checkoutId: string;
  reference: string;
  employeeName: string;
  lines: ReturnLine[];
  acknowledgement: string;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(lines.map((l) => [l.lineId, { quantity: l.outstanding, condition: "good" as Condition, note: "" }]))
  );
  const [notes, setNotes] = useState("");
  const [signing, setSigning] = useState(false);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [returnedAt, setReturnedAt] = useState("");
  const [pending, startTransition] = useTransition();

  const set = (lineId: string, patch: Partial<Entry>) => setEntries((e) => ({ ...e, [lineId]: { ...e[lineId], ...patch } }));
  const returning = lines.filter((l) => entries[l.lineId].quantity > 0);
  const units = returning.reduce((n, l) => n + entries[l.lineId].quantity, 0);
  const remainingAfter = lines
    .map((l) => ({ l, left: l.outstanding - entries[l.lineId].quantity }))
    .filter((x) => x.left > 0);

  const review = () => {
    if (!returning.length) {
      setProblem("Enter how many of at least one item are being returned.");
      return;
    }
    setProblem(null);
    setError(null);
    setDrawing(null);
    setReturnedAt(formatDateTime(new Date()));
    // One request per review, as on Check Out.
    setRequestId(newRequestId());
    setSigning(true);
  };

  const confirm = () => {
    if (!drawing) return;
    setError(null);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof checkInEquipment>>;
      try {
        result = await checkInEquipment({
          requestId,
          checkoutId,
          lines: lines.map((l) => ({ line_id: l.lineId, quantity: entries[l.lineId].quantity, condition: entries[l.lineId].condition, note: entries[l.lineId].note || undefined })),
          drawing: JSON.stringify(drawing),
          acknowledgement,
          notes,
        });
      } catch {
        // As on Check Out: keep the signature and the request id.
        setError(NO_ANSWER);
        return;
      }
      if (result.error || !result.id) {
        setError(result.error ?? "The return was not saved. Try again.");
        return;
      }
      router.replace(`/staff/stores/transactions/return/${result.id}?done=1`);
    });
  };

  return (
    <>
      <div className="space-y-3 pb-24 md:pb-4">
        {lines.map((l) => {
          const e = entries[l.lineId];
          return (
            <section key={l.lineId} className="surface space-y-3 p-4">
              <div className="flex items-center gap-3">
                {l.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a private, session-checked route
                  <img src={l.photoUrl} alt="" className="size-12 shrink-0 rounded-lg border border-border/70 object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold">{l.itemName}</h2>
                  <p className="text-xs text-muted-foreground">
                    Issued {l.quantity}{l.returned ? `, returned ${l.returned}` : ""}, <span className="font-medium text-foreground">outstanding {l.outstanding}</span>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-muted-foreground">Returning now</span>
                <QuantityStepper value={e.quantity} min={0} max={l.outstanding} onChange={(n) => set(l.lineId, { quantity: n })} label={`Quantity of ${l.itemName} returned`} />
              </div>
              {e.quantity > 0 ? (
                <fieldset>
                  <legend className="mb-1.5 text-sm text-muted-foreground">Condition</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {CONDITIONS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={e.condition === c}
                        // Back to Good clears the note: it was hidden with the
                        // box, and a hidden "screen cracked" was still being
                        // saved against a return marked good.
                        onClick={() => set(l.lineId, c === "good" ? { condition: c, note: "" } : { condition: c })}
                        className={cn(
                          "min-h-11 rounded-xl border px-2 text-sm font-medium transition-colors",
                          e.condition === c ? (c === "good" ? "border-success bg-success/10 text-success" : "border-warning bg-warning/20 text-warning-foreground") : "border-input bg-card hover:bg-muted"
                        )}
                      >
                        {CONDITION_LABELS[c]}
                      </button>
                    ))}
                  </div>
                  {e.condition !== "good" ? (
                    <Input className="mt-2" placeholder="What is wrong with it? (optional)" value={e.note} maxLength={500} onChange={(ev) => set(l.lineId, { note: ev.target.value })} aria-label={`Note about ${l.itemName}`} />
                  ) : null}
                </fieldset>
              ) : null}
            </section>
          );
        })}

        <details className="surface p-4">
          <summary className="cursor-pointer text-sm font-medium">Add a note (optional)</summary>
          <Textarea className="mt-3" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} aria-label="Note about this return" />
        </details>

        {problem ? <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{problem}</p> : null}

        <div className="fixed inset-x-0 bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
          <Button type="button" onClick={review} className="h-13 w-full text-base font-semibold md:h-11">
            <PenLine aria-hidden /> Review and sign{units ? ` · ${units} returning` : ""}
          </Button>
        </div>
      </div>

      {signing ? (
        <AcknowledgementScreen
          title="Hibiscus Schools – Equipment Return Acknowledgement"
          facts={[
            { label: "Employee name", value: employeeName },
            { label: "Return date", value: returnedAt },
            { label: "Checkout", value: reference },
          ]}
          linesLabel="Equipment being returned"
          lines={returning.map((l) => ({ key: l.lineId, text: quantityLine(entries[l.lineId].quantity, l.itemName, l.unit), detail: [`Condition: ${CONDITION_LABELS[entries[l.lineId].condition]}`, entries[l.lineId].note.trim()].filter(Boolean).join(" · ") }))}
          after={
            remainingAfter.length ? (
              <p className="mt-2 rounded-lg bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
                Still outstanding after this return: {remainingAfter.map((x) => quantityLine(x.left, x.l.itemName, x.l.unit)).join(", ")}.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Everything on this checkout will be back.</p>
            )
          }
          acknowledgement={acknowledgement}
          onBack={() => setSigning(false)}
          onDrawing={setDrawing}
          onConfirm={confirm}
          confirmLabel="Confirm return"
          pending={pending}
          error={error}
          signed={Boolean(drawing)}
        />
      ) : null}
    </>
  );
}
