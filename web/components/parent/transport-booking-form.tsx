"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileInput } from "@/components/ui/mobile-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/lib/money";
import { SERVICE_LABELS, WEEKDAYS, type WeekdaySet } from "@/lib/transport/days";
import { estimateCustomerTotal, type CustomerTariff, type RiderService } from "@/lib/transport/pricing";

export type TransportFormState = {
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
};

/** What the page hands the form: reference data, and the parent's prices only. */
export type TransportFormCatalogue = {
  periods: Array<{ id: string; label: string; kind: "term" | "month"; divisor: number; price_list_id: string; dates: string; closes: string }>;
  areas: Array<{ id: string; name: string; zone_id: string }>;
  campuses: Array<{ id: string; name: string; grades: Array<{ id: string; name: string }> }>;
  tariffs: Array<CustomerTariff & { price_list_id: string }>;
  terms: { id: string; version: number; body_text: string; body_hash: string };
  officeContact: string;
};

const MAX_CHILDREN = 6;
const DAY_SHORT: Record<(typeof WEEKDAYS)[number], string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri" };

type ChildState = { key: number; campusId: string; gradeId: string; service: RiderService; days: WeekdaySet };

const ALL_DAYS: WeekdaySet = { mon: true, tue: true, wed: true, thu: true, fri: true };

function childrenFrom(values: Record<string, string>): ChildState[] {
  const count = Math.min(Math.max(Number(values.children) || 1, 1), MAX_CHILDREN);
  return Array.from({ length: count }, (_, i) => {
    const p = `child_${i + 1}_`;
    const service = values[`${p}service`];
    const anyDay = WEEKDAYS.some((d) => `${p}${d}` in values);
    return {
      key: i,
      campusId: values[`${p}campus_id`] ?? "",
      gradeId: values[`${p}grade_id`] ?? "",
      service: service === "am" || service === "pm" ? service : "full",
      days: anyDay ? (Object.fromEntries(WEEKDAYS.map((d) => [d, values[`${p}${d}`] === "1"])) as WeekdaySet) : { ...ALL_DAYS },
    };
  });
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * The booking form. Who you are, where we collect from, which term or month,
 * and each child. The estimate beside it uses the same rule the database
 * charges by, from the parent's prices alone; the amount to pay is shown on
 * the next page, from what the database wrote, before anybody pays.
 */
export function TransportBookingForm({
  catalogue,
  action,
}: {
  catalogue: TransportFormCatalogue;
  action: (state: TransportFormState, formData: FormData) => Promise<TransportFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const f = state.fields ?? {};
  const v = state.values ?? {};
  const uid = useId();

  const [periodId, setPeriodId] = useState(v.period_id ?? (catalogue.periods.length === 1 ? catalogue.periods[0].id : ""));
  const [areaId, setAreaId] = useState(v.area_id ?? "");
  const [children, setChildren] = useState<ChildState[]>(() => childrenFrom(v));
  const [nextKey, setNextKey] = useState(children.length);

  const invalid = (name: string) => (f[name] ? { "aria-invalid": true, "aria-describedby": `${name}-error` } : {});
  const update = (key: number, patch: Partial<ChildState>) => setChildren((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const estimate = useMemo(() => {
    const period = catalogue.periods.find((p) => p.id === periodId);
    const area = catalogue.areas.find((a) => a.id === areaId);
    if (!period || !area || children.some((c) => !c.campusId)) return null;
    return estimateCustomerTotal({
      zoneId: area.zone_id,
      divisor: period.divisor,
      tariffs: catalogue.tariffs.filter((t) => t.price_list_id === period.price_list_id),
      riders: children.map((c) => ({ campusId: c.campusId, service: c.service, days: WEEKDAYS.filter((d) => c.days[d]).length })),
    });
  }, [catalogue, periodId, areaId, children]);

  return (
    <form action={formAction} className="space-y-8" noValidate>
      <input type="hidden" name="children" value={children.length} />
      <input type="hidden" name="terms_id" value={catalogue.terms.id} />
      <input type="hidden" name="terms_hash" value={catalogue.terms.body_hash} />

      {state.error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-foreground">Which term or month?</legend>
        {catalogue.periods.map((p) => (
          <label key={p.id} className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm has-[:checked]:border-primary">
            <input
              type="radio"
              name="period_id"
              value={p.id}
              checked={periodId === p.id}
              onChange={() => setPeriodId(p.id)}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span>
              <span className="font-medium">{p.label}</span>
              <span className="block text-xs text-muted-foreground">
                {p.dates}. {p.kind === "month" ? "One month." : "The whole term."} Book by {p.closes}.
              </span>
            </span>
          </label>
        ))}
        {f.period_id ? (
          <p id="period_id-error" className="text-sm text-destructive">
            {f.period_id}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-foreground">About you</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field id="parent_first_name" label="First name" error={f.parent_first_name}>
            <Input id="parent_first_name" name="parent_first_name" autoComplete="given-name" defaultValue={v.parent_first_name} required {...invalid("parent_first_name")} />
          </Field>
          <Field id="parent_last_name" label="Surname" error={f.parent_last_name}>
            <Input id="parent_last_name" name="parent_last_name" autoComplete="family-name" defaultValue={v.parent_last_name} required {...invalid("parent_last_name")} />
          </Field>
        </div>
        <Field id="mobile" label="Mobile number" error={f.mobile} hint="The driver and the school call this number.">
          <MobileInput name="mobile" defaultValue={v.mobile} required invalid={Boolean(f.mobile)} />
        </Field>
        <Field id="email" label="Email address" error={f.email} hint="Your receipt is sent here.">
          <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" defaultValue={v.email} required {...invalid("email")} />
        </Field>
        {/* Stacked, not side by side: the mobile field is a country and a
            number, and half a phone's width is too narrow for both. */}
        <Field id="second_contact_name" label="Another adult we can call (optional)" error={f.second_contact_name}>
          <Input id="second_contact_name" name="second_contact_name" autoComplete="off" defaultValue={v.second_contact_name} {...invalid("second_contact_name")} />
        </Field>
        <Field id="second_contact_mobile" label="Their mobile number (optional)" error={f.second_contact_mobile}>
          <MobileInput name="second_contact_mobile" defaultValue={v.second_contact_mobile} invalid={Boolean(f.second_contact_mobile)} />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-foreground">Where do we collect from?</legend>
        <Field
          id="area_id"
          label="Your area"
          error={f.area_id}
          hint={`Not listed? We may not reach your area yet. Please contact ${catalogue.officeContact || "the school office"}.`}
        >
          <NativeSelect id="area_id" name="area_id" value={areaId} onChange={(e) => setAreaId(e.target.value)} required {...invalid("area_id")}>
            <option value="" disabled>
              Choose your area
            </option>
            {catalogue.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="address_line" label="Street or plot" error={f.address_line}>
          <Input id="address_line" name="address_line" autoComplete="street-address" defaultValue={v.address_line} required {...invalid("address_line")} />
        </Field>
        <Field id="landmark" label="Landmark (optional)" error={f.landmark} hint="Something the driver can look for, like the gate colour or a shop nearby.">
          <Input id="landmark" name="landmark" autoComplete="off" defaultValue={v.landmark} {...invalid("landmark")} />
        </Field>
        <Field id="notes" label="Anything else the driver should know (optional)" error={f.notes}>
          <Textarea id="notes" name="notes" rows={2} defaultValue={v.notes} {...invalid("notes")} />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-1 text-sm font-semibold text-foreground">Your children</legend>
        {children.map((c, i) => {
          const n = i + 1;
          const p = `child_${n}_`;
          const campus = catalogue.campuses.find((x) => x.id === c.campusId);
          const line = estimate?.lines[i];
          return (
            <div key={c.key} className="surface space-y-4 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Child {n}</p>
                {children.length > 1 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setChildren((cs) => cs.filter((x) => x.key !== c.key))}>
                    <X data-icon="inline-start" /> Remove
                  </Button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field id={`${p}first_name`} label="First name" error={f[`${p}first_name`]}>
                  <Input id={`${p}first_name`} name={`${p}first_name`} autoComplete="off" defaultValue={v[`${p}first_name`]} required {...invalid(`${p}first_name`)} />
                </Field>
                <Field id={`${p}last_name`} label="Surname" error={f[`${p}last_name`]}>
                  <Input id={`${p}last_name`} name={`${p}last_name`} autoComplete="off" defaultValue={v[`${p}last_name`]} required {...invalid(`${p}last_name`)} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field id={`${p}campus_id`} label="School" error={f[`${p}campus_id`]}>
                  <NativeSelect
                    id={`${p}campus_id`}
                    name={`${p}campus_id`}
                    value={c.campusId}
                    onChange={(e) => update(c.key, { campusId: e.target.value, gradeId: "" })}
                    required
                    {...invalid(`${p}campus_id`)}
                  >
                    <option value="" disabled>
                      Choose
                    </option>
                    {catalogue.campuses.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id={`${p}grade_id`} label="Grade" error={f[`${p}grade_id`]}>
                  <NativeSelect
                    id={`${p}grade_id`}
                    name={`${p}grade_id`}
                    value={c.gradeId}
                    onChange={(e) => update(c.key, { gradeId: e.target.value })}
                    disabled={!campus}
                    required
                    {...invalid(`${p}grade_id`)}
                  >
                    <option value="" disabled>
                      {campus ? "Choose" : "Choose a school first"}
                    </option>
                    {(campus?.grades ?? []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">When does {n === 1 ? "this child" : `child ${n}`} ride?</p>
                {(["full", "am", "pm"] as const).map((service) => (
                  <label key={service} className="flex items-center gap-3 text-sm">
                    <input
                      type="radio"
                      name={`${p}service`}
                      value={service}
                      checked={c.service === service}
                      onChange={() => update(c.key, { service })}
                      className="size-5 shrink-0 accent-primary"
                    />
                    {SERVICE_LABELS[service]}
                  </label>
                ))}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium" id={`${uid}-${c.key}-days`}>
                  Which days?
                </p>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${uid}-${c.key}-days`}>
                  {WEEKDAYS.map((d) => (
                    <label key={d} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm has-[:checked]:border-primary">
                      <input
                        type="checkbox"
                        name={`${p}${d}`}
                        value="1"
                        checked={c.days[d]}
                        onChange={(e) => update(c.key, { days: { ...c.days, [d]: e.target.checked } })}
                        className="size-5 accent-primary"
                      />
                      {DAY_SHORT[d]}
                    </label>
                  ))}
                </div>
                {f[`${p}days`] ? <p className="text-sm text-destructive">{f[`${p}days`]}</p> : null}
              </div>
              <Field id={`${p}notes`} label="Notes for the driver (optional)" error={f[`${p}notes`]} hint="For example: collected from aftercare at 16:30.">
                <Input id={`${p}notes`} name={`${p}notes`} autoComplete="off" defaultValue={v[`${p}notes`]} {...invalid(`${p}notes`)} />
              </Field>
              {line ? (
                <p className="text-right text-sm text-muted-foreground">
                  About <span className="font-semibold text-foreground tabular-nums">{formatMoney(line.amountMinor, "BWP")}</span>
                </p>
              ) : null}
            </div>
          );
        })}
        {children.length < MAX_CHILDREN ? (
          <Button
            type="button"
            variant="outline"
            size="parent"
            onClick={() => {
              setChildren((cs) => [...cs, { key: nextKey, campusId: "", gradeId: "", service: "full", days: { ...ALL_DAYS } }]);
              setNextKey((k) => k + 1);
            }}
          >
            <Plus data-icon="inline-start" /> Add another child
          </Button>
        ) : null}
      </fieldset>

      <section className="rounded-2xl bg-muted p-4 text-sm" aria-live="polite">
        {estimate ? (
          <>
            <p className="flex justify-between font-semibold">
              <span>Estimated total</span>
              <span className="tabular-nums">{formatMoney(estimate.totalMinor, "BWP")}</span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">The exact amount is on the next page, before you pay.</p>
          </>
        ) : (
          <p className="text-muted-foreground">Choose the term or month, your area and each child&rsquo;s school to see the price.</p>
        )}
      </section>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold text-foreground">The transport terms</legend>
        <div className="max-h-56 overflow-y-auto rounded-xl border border-border p-3 text-sm whitespace-pre-line">{catalogue.terms.body_text}</div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="accept_terms" value="1" defaultChecked={v.accept_terms === "1"} className="mt-0.5 size-5 shrink-0 accent-primary" {...invalid("accept_terms")} />
          <span>I have read the transport terms and I agree to them.</span>
        </label>
        {f.accept_terms ? (
          <p id="accept_terms-error" className="text-sm text-destructive">
            {f.accept_terms}
          </p>
        ) : null}
      </fieldset>

      <Button type="submit" size="parent" disabled={pending}>
        {pending ? "One moment…" : "Continue to payment"}
        {!pending ? <ArrowRight data-icon="inline-end" /> : null}
      </Button>
    </form>
  );
}
