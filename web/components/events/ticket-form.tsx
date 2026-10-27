"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileInput } from "@/components/ui/mobile-input";
import { Field, HolderNames, Honeypot, invalidProps } from "@/components/events/form-bits";
import { formatMoney } from "@/lib/money";
import type { EventFormState } from "@/app/(public)/events/[slug]/actions";

/**
 * Choose how many tickets, name the person on each, give your own details,
 * pay. A name box appears for every ticket, because every ticket carries the
 * name of the person it lets in.
 *
 * The total is worked out here for the button only. What is charged is
 * decided on the server from the event's own prices; the form sends no
 * figure at all.
 */
export function TicketForm({
  action,
  maxTickets,
  unitMinor,
  currency,
  ticketLabel,
}: {
  action: (state: EventFormState, formData: FormData) => Promise<EventFormState>;
  maxTickets: number;
  unitMinor: number;
  currency: string;
  ticketLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const values = state.values ?? {};
  const [count, setCount] = useState(() => {
    const n = Number(values.quantity);
    return Number.isInteger(n) && n >= 1 && n <= maxTickets ? n : 1;
  });
  const total = formatMoney(unitMinor * count, currency);
  const noun = ticketLabel.toLowerCase();

  return (
    <form action={formAction} className="relative space-y-7">
      <Honeypot />
      {state.error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-base font-semibold">How many {noun}s?</h3>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="size-12 rounded-xl"
            aria-label={`One ${noun} fewer`}
            disabled={count <= 1}
            onClick={() => setCount((c) => Math.max(1, c - 1))}
          >
            <Minus />
          </Button>
          <output aria-live="polite" className="min-w-16 text-center text-3xl font-bold tabular-nums">
            {count}
          </output>
          <Button
            type="button"
            variant="outline"
            className="size-12 rounded-xl"
            aria-label={`One ${noun} more`}
            disabled={count >= maxTickets}
            onClick={() => setCount((c) => Math.min(maxTickets, c + 1))}
          >
            <Plus />
          </Button>
          <p className="text-sm text-muted-foreground">
            {formatMoney(unitMinor, currency)} each
            <span className="block text-xs">Up to {maxTickets} in one order</span>
          </p>
        </div>
        <input type="hidden" name="quantity" value={count} />
        {errors.quantity ? <p className="text-sm text-destructive">{errors.quantity}</p> : null}
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Who is coming?</h3>
          <p className="mt-1 text-sm text-muted-foreground">Type the name of each person. Their name is printed on their own ticket.</p>
        </div>
        <div className="space-y-4 rounded-2xl bg-muted/60 p-4">
          {Array.from({ length: count }, (_, i) => (
            <HolderNames key={i} index={i} legend={`${ticketLabel} ${i + 1}`} errors={errors} values={values} />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Your details</h3>
          <p className="mt-1 text-sm text-muted-foreground">We email the tickets to you. You do not need to be one of the people coming.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="firstName" label="Your first name" error={errors.firstName}>
            <Input id="firstName" name="firstName" autoComplete="given-name" defaultValue={values.firstName} required maxLength={80} {...invalidProps(errors, "firstName")} />
          </Field>
          <Field id="lastName" label="Your last name" error={errors.lastName}>
            <Input id="lastName" name="lastName" autoComplete="family-name" defaultValue={values.lastName} required maxLength={80} {...invalidProps(errors, "lastName")} />
          </Field>
        </div>
        <Field id="email" label="Email address" error={errors.email} hint="Your tickets are sent here.">
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={values.email} required maxLength={200} {...invalidProps(errors, "email")} />
        </Field>
        <Field id="mobile" label="Mobile number (optional)" error={errors.mobile} hint="Only if we need to reach you about the show.">
          <MobileInput name="mobile" defaultValue={values.mobile} invalid={Boolean(errors.mobile)} />
        </Field>
      </section>

      <div className="space-y-3 border-t border-border/70 pt-6">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">
            {count} × {formatMoney(unitMinor, currency)}
          </span>
          <span className="text-xl font-bold tabular-nums">{total}</span>
        </div>
        <Button type="submit" size="parent" disabled={pending}>
          {pending ? "Taking you to the payment page…" : `Pay ${total}`}
          {!pending ? <ArrowRight data-icon="inline-end" /> : null}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          You pay on the school&rsquo;s secure payment page. We never see your card details. Your tickets are emailed to you as soon as the
          payment is confirmed.
        </p>
      </div>
    </form>
  );
}
