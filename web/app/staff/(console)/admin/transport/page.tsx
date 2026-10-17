import Link from "next/link";
import { ActionForm } from "@/components/staff/action-form";
import { PageTitle } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateLong, formatDateRange, toSchoolDateString } from "@/lib/format-date";
import { canAccessPath } from "@/lib/permissions";
import { requireStaff } from "@/lib/staff/session";
import type { TransportPeriodRow } from "@/lib/supabase/types";
import { bookablePeriods } from "@/lib/transport/catalogue";
import { publishTransportTerms, saveTransportOfficeContact, saveTransportPeriod, setTransportBooking } from "./actions";

export const metadata = { title: "School transport" };
export const dynamic = "force-dynamic";

/**
 * Opening school transport booking. Three things must all be true before a
 * parent can book — the switch, a published period whose booking window is
 * open, and published terms — and the page says which are missing. The
 * database refuses a booking without all three, whatever this page shows.
 */
export default async function TransportSettingsPage() {
  const { supabase, permissions } = await requireStaff("transport.manage");
  const [settingsRes, periodsRes, termsRes, listsRes] = await Promise.all([
    supabase.from("settings").select("key, value").in("key", ["transport_booking_enabled", "transport_office_contact"]),
    supabase.from("transport_periods").select("*").order("starts_on").order("month_index", { nullsFirst: true }),
    supabase.from("transport_terms").select("id, version, body_text, published_at").not("published_at", "is", null).order("version", { ascending: false }).limit(1),
    supabase.from("transport_price_lists").select("id, label").order("created_at"),
  ]);
  const setting = (key: string) => settingsRes.data?.find((s) => s.key === key)?.value;
  const enabled = setting("transport_booking_enabled") === true;
  const contact = typeof setting("transport_office_contact") === "string" ? (setting("transport_office_contact") as string) : "";
  const periods = periodsRes.data ?? [];
  const terms = termsRes.data?.[0] ?? null;
  const lists = listsRes.data ?? [];
  const open = bookablePeriods(periods, toSchoolDateString(new Date()));

  const termsOf = periods.filter((p) => p.kind === "term");
  const monthsOf = (termId: string) => periods.filter((p) => p.term_period_id === termId);

  const periodForm = (p: TransportPeriodRow | null, opts: { kind: "term" | "month"; termId?: string; monthIndex?: number }) => (
    <ActionForm
      key={p?.id ?? `new-${opts.kind}-${opts.termId ?? ""}`}
      action={saveTransportPeriod}
      label={p ? "Save" : opts.kind === "term" ? "Add the term" : "Add the month"}
      size="sm"
      variant={p ? "outline" : "default"}
      resetOnSubmit={!p}
      className="surface grid gap-2 p-3 md:grid-cols-[1fr_130px_130px_130px_130px_auto]"
    >
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <input type="hidden" name="kind" value={opts.kind} />
      {opts.termId ? <input type="hidden" name="termPeriodId" value={opts.termId} /> : null}
      {opts.monthIndex ? <input type="hidden" name="monthIndex" value={opts.monthIndex} /> : null}
      <Input name="label" defaultValue={p?.label ?? ""} placeholder={opts.kind === "term" ? "Term 1, 2027" : "January 2027"} required className="h-8 md:h-8" aria-label="Name" />
      <label className="text-[11px] text-muted-foreground">
        Starts
        <Input name="startsOn" type="date" defaultValue={p?.starts_on ?? ""} required className="h-8 md:h-8" />
      </label>
      <label className="text-[11px] text-muted-foreground">
        Ends
        <Input name="endsOn" type="date" defaultValue={p?.ends_on ?? ""} required className="h-8 md:h-8" />
      </label>
      <label className="text-[11px] text-muted-foreground">
        Booking opens
        <Input name="opensOn" type="date" defaultValue={p?.booking_opens_on ?? ""} required className="h-8 md:h-8" />
      </label>
      <label className="text-[11px] text-muted-foreground">
        Booking closes
        <Input name="closesOn" type="date" defaultValue={p?.booking_closes_on ?? ""} required className="h-8 md:h-8" />
      </label>
      <label className="flex items-center gap-1 self-end pb-2 text-xs">
        <input type="checkbox" name="isPublished" value="1" defaultChecked={p ? p.is_published : false} /> published
      </label>
      {!p && opts.kind === "term" ? (
        <div className="md:col-span-6">
          <NativeSelect name="priceListId" defaultValue={lists[0]?.id ?? ""} required className="h-8 md:h-8" aria-label="Price list">
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                Prices: {l.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </ActionForm>
  );

  return (
    <>
      <PageTitle
        // A transport coordinator holds no admissions permission, so the
        // Settings hub is not theirs to go back to.
        back={canAccessPath(permissions, "/staff/admin") ? { href: "/staff/admin", label: "Settings" } : undefined}
        title="School transport"
        description="What parents can book on the public page at /transport. Prices come from the price list; children are priced when the booking is made and never re-priced."
      />

      <section className="surface space-y-3 p-4 text-sm">
        <h2 className="font-semibold">Can parents book now?</h2>
        <ul className="space-y-1">
          <li>{enabled ? "✓" : "✗"} Booking is {enabled ? "switched on" : "switched off"}.</li>
          <li>
            {open.length ? "✓" : "✗"}{" "}
            {open.length ? `Open for: ${open.map((p) => p.label).join(", ")}.` : "No published term or month is open for booking today."}
          </li>
          <li>{terms ? `✓ Terms version ${terms.version} is published.` : "✗ No terms are published yet."}</li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm action={setTransportBooking} label={enabled ? "Switch booking off" : "Switch booking on"} size="sm" variant={enabled ? "outline" : "default"}>
            <input type="hidden" name="booking" value={enabled ? "off" : "on"} />
          </ActionForm>
          <Link href="/transport" className="text-xs font-medium text-primary underline underline-offset-2" target="_blank">
            Open the parents&rsquo; page
          </Link>
        </div>
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold">Who parents contact</h2>
        <ActionForm action={saveTransportOfficeContact} label="Save" size="sm" variant="outline" resetOnSubmit={false} className="surface flex gap-2 p-3">
          <Input name="contact" defaultValue={contact} placeholder="the transport desk on 71 234 567" className="h-8 md:h-8" aria-label="Who parents contact" />
        </ActionForm>
        <p className="text-xs text-muted-foreground">Shown on the booking pages and in the emails, after &ldquo;please contact&rdquo;.</p>
      </section>

      <section className="mt-6 space-y-3">
        <h2 className="text-sm font-semibold">Terms and months</h2>
        <p className="text-xs text-muted-foreground">
          A parent books a whole term, or one month of it at a third of the term price. Booking closes on its own date, which must be
          before the period ends. Only published periods are shown to parents.
        </p>
        {termsOf.map((term) => {
          const months = monthsOf(term.id);
          const nextMonth = [1, 2, 3].slice(0, term.billing_months).find((i) => !months.some((m) => m.month_index === i));
          return (
            <div key={term.id} className="space-y-2">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{term.label}</span> · {formatDateRange(term.starts_on, term.ends_on)} · booking{" "}
                {formatDateLong(term.booking_opens_on)} to {formatDateLong(term.booking_closes_on)}
                {term.is_published ? "" : " · not published"}
              </p>
              {periodForm(term, { kind: "term" })}
              <div className="space-y-2 border-l-2 border-border pl-4">
                {months.map((m) => periodForm(m, { kind: "month", termId: term.id }))}
                {nextMonth ? (
                  <>
                    <p className="text-xs text-muted-foreground">Add month {nextMonth} of this term</p>
                    {periodForm(null, { kind: "month", termId: term.id, monthIndex: nextMonth })}
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
        <h3 className="pt-2 text-sm font-semibold">Add a term</h3>
        {periodForm(null, { kind: "term" })}
      </section>

      <section className="mt-8 space-y-2">
        <h2 className="text-sm font-semibold">The transport terms</h2>
        {terms ? (
          <div className="surface p-3 text-xs">
            <p className="font-medium">
              Version {terms.version}, published {formatDateLong(terms.published_at)}
            </p>
            <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line text-muted-foreground">{terms.body_text}</p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Nothing is published yet. Parents cannot book until there is.</p>
        )}
        <ActionForm action={publishTransportTerms} label="Publish as a new version" size="sm" className="surface space-y-2 p-3" confirm="Parents booking from now on agree to this version. Publish it?">
          <Textarea name="body" rows={10} defaultValue={terms?.body_text ?? ""} placeholder="The terms the school and the transport provider agreed, in plain English." className="text-xs" aria-label="Terms" />
        </ActionForm>
        <p className="text-xs text-muted-foreground">A published version never changes. Each booking keeps the version its parent agreed to.</p>
      </section>
    </>
  );
}
