"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MobileInput } from "@/components/ui/mobile-input";
import { Textarea } from "@/components/ui/textarea";
import { Field, HolderNames, Honeypot, invalidProps } from "@/components/events/form-bits";
import { formatMoney } from "@/lib/money";
import type { EventFormState } from "@/app/(public)/events/[slug]/actions";

/**
 * Booking a stall: the business, the person booking it, and a name for each
 * of the stall's other tickets. The person booking is the first ticket, so
 * the form asks only for the rest (`holderFirst1` onward).
 */
export function StallForm({
  action,
  priceMinor,
  currency,
  stallTickets,
}: {
  action: (state: EventFormState, formData: FormData) => Promise<EventFormState>;
  priceMinor: number;
  currency: string;
  stallTickets: number;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const errors = state.errors ?? {};
  const values = state.values ?? {};
  const price = formatMoney(priceMinor, currency);
  const staff = Math.max(0, stallTickets - 1);

  return (
    <form action={formAction} className="relative space-y-7">
      <Honeypot />
      {state.error ? (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <section className="space-y-4">
        <h3 className="text-base font-semibold">Your stall</h3>
        <Field id="businessName" label="Business or stall name" error={errors.businessName}>
          <Input id="businessName" name="businessName" autoComplete="organization" defaultValue={values.businessName} required maxLength={120} {...invalidProps(errors, "businessName")} />
        </Field>
        <Field id="goods" label="What will you sell? (optional)" error={errors.goods} hint="For example: cakes and biscuits, handmade cards, toys.">
          <Textarea id="goods" name="goods" rows={3} defaultValue={values.goods} maxLength={500} {...invalidProps(errors, "goods")} />
        </Field>
        <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-sm">
          <input type="checkbox" name="needsPower" defaultChecked={values.needsPower === "on"} className="mt-0.5 size-5 accent-[var(--primary)]" />
          <span>
            <span className="font-medium">I need electricity at my stall</span>
            <span className="block text-xs text-muted-foreground">We will tell you if we cannot provide it.</span>
          </span>
        </label>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Your details</h3>
          <p className="mt-1 text-sm text-muted-foreground">You are the stallholder. Your name goes on the first of the stall&rsquo;s tickets.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="firstName" label="First name" error={errors.firstName}>
            <Input id="firstName" name="firstName" autoComplete="given-name" defaultValue={values.firstName} required maxLength={80} {...invalidProps(errors, "firstName")} />
          </Field>
          <Field id="lastName" label="Last name" error={errors.lastName}>
            <Input id="lastName" name="lastName" autoComplete="family-name" defaultValue={values.lastName} required maxLength={80} {...invalidProps(errors, "lastName")} />
          </Field>
        </div>
        <Field id="email" label="Email address" error={errors.email} hint="Your booking and tickets are sent here.">
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={values.email} required maxLength={200} {...invalidProps(errors, "email")} />
        </Field>
        <Field id="mobile" label="Mobile number" error={errors.mobile} hint="So we can reach you on the day.">
          <MobileInput name="mobile" defaultValue={values.mobile} required invalid={Boolean(errors.mobile)} />
        </Field>
      </section>

      {staff > 0 ? (
        <section className="space-y-4">
          <div>
            <h3 className="text-base font-semibold">{staff === 1 ? "Your staff member" : "Your staff"}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {staff === 1 ? "The stall comes with one more ticket. Type the name of the person who will help you." : `The stall comes with ${staff} more tickets. Type the name of each person who will help you.`}
            </p>
          </div>
          <div className="space-y-4 rounded-2xl bg-muted/60 p-4">
            {Array.from({ length: staff }, (_, i) => (
              <HolderNames key={i} index={i + 1} legend={staff === 1 ? "Staff ticket" : `Staff ticket ${i + 1}`} errors={errors} values={values} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="space-y-3 border-t border-border/70 pt-6">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">One stall, {stallTickets} tickets included</span>
          <span className="text-xl font-bold tabular-nums">{price}</span>
        </div>
        <Button type="submit" size="parent" disabled={pending}>
          {pending ? "Taking you to the payment page…" : `Pay ${price}`}
          {!pending ? <ArrowRight data-icon="inline-end" /> : null}
        </Button>
        <p className="text-xs leading-relaxed text-muted-foreground">
          You pay on the school&rsquo;s secure payment page. Your booking and tickets are emailed to you as soon as the payment is confirmed.
        </p>
      </div>
    </form>
  );
}
