"use client";

import { useMemo, useState } from "react";
import { formatMoney, parseMoneyToMinor } from "@/lib/money";

/**
 * The lines of a payment to the transport provider: a tick per child it is
 * owed for, an amount box per cancelled child a credit may be taken for, and
 * the total as it stands. The total is only a guide while the form is filled
 * in; `transport_record_payout()` works out each charge itself from the
 * child's frozen line and refuses anything it would not pay.
 *
 * The provider's amounts reach the browser here, on a staff screen behind
 * `transport.finance`. It is the parent's form that must never carry them.
 */

export type PayoutChargeLine = { id: string; label: string; detail: string; amountMinor: number };
export type PayoutCreditLine = { id: string; label: string; detail: string; maxMinor: number; refundedMinor: number };

export function TransportPayoutLines({ charges, credits }: { charges: PayoutChargeLine[]; credits: PayoutCreditLine[] }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(charges.map((c) => c.id)));
  const [typed, setTyped] = useState<Record<string, string>>({});

  const { chargeMinor, creditMinor, bad } = useMemo(() => {
    const chargeMinor = charges.filter((c) => ticked.has(c.id)).reduce((s, c) => s + c.amountMinor, 0);
    let creditMinor = 0;
    let bad = false;
    for (const c of credits) {
      const v = typed[c.id]?.trim();
      if (!v) continue;
      const m = parseMoneyToMinor(v);
      if (m === null || m <= 0 || m > c.maxMinor) bad = true;
      else creditMinor += m;
    }
    return { chargeMinor, creditMinor, bad };
  }, [charges, credits, ticked, typed]);

  const toggleAll = (on: boolean) => setTicked(on ? new Set(charges.map((c) => c.id)) : new Set());

  return (
    <div className="space-y-4">
      <fieldset className="space-y-1">
        <legend className="flex w-full items-center justify-between text-sm font-semibold">
          <span>Owed for ({charges.length})</span>
          <span className="space-x-3 text-xs font-normal">
            <button type="button" className="underline" onClick={() => toggleAll(true)}>
              Tick all
            </button>
            <button type="button" className="underline" onClick={() => toggleAll(false)}>
              Untick all
            </button>
          </span>
        </legend>
        <ul className="surface max-h-[28rem] divide-y divide-border overflow-y-auto text-xs">
          {charges.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  name="charge"
                  value={c.id}
                  checked={ticked.has(c.id)}
                  onChange={(e) => {
                    const next = new Set(ticked);
                    if (e.target.checked) next.add(c.id);
                    else next.delete(c.id);
                    setTicked(next);
                  }}
                />
                <span className="grow">
                  <span className="font-medium">{c.label}</span>
                  <span className="block text-muted-foreground">{c.detail}</span>
                </span>
                <span className="tabular-nums">{formatMoney(c.amountMinor, "BWP")}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {credits.length ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-semibold">Credits for cancelled children ({credits.length})</legend>
          <p className="text-xs text-muted-foreground">
            These children were cancelled after the provider was paid for them. Enter the credit agreed with the provider, or leave the box empty to decide later.
          </p>
          <ul className="surface divide-y divide-border text-xs">
            {credits.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="grow">
                  <span className="font-medium">{c.label}</span>
                  <span className="block text-muted-foreground">
                    {c.detail}. Paid {formatMoney(c.maxMinor, "BWP")} for this child; the parent was refunded {formatMoney(c.refundedMinor, "BWP")}.
                  </span>
                </span>
                <label className="text-[11px] text-muted-foreground">
                  Credit (P)
                  <input
                    name={`credit:${c.id}`}
                    inputMode="decimal"
                    value={typed[c.id] ?? ""}
                    onChange={(e) => setTyped({ ...typed, [c.id]: e.target.value })}
                    placeholder={`up to ${(c.maxMinor / 100).toFixed(2)}`}
                    className="block h-8 w-32 rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <p className="text-sm">
        Paying for <span className="font-medium">{ticked.size}</span> {ticked.size === 1 ? "child" : "children"}: {formatMoney(chargeMinor, "BWP")}
        {creditMinor ? `, less credits of ${formatMoney(creditMinor, "BWP")}` : ""}.{" "}
        <span className="font-semibold">Total {formatMoney(chargeMinor - creditMinor, "BWP")}</span>
        {bad ? <span className="block text-xs text-destructive">A credit is not an amount, or is more than was paid for that child.</span> : null}
      </p>
    </div>
  );
}
