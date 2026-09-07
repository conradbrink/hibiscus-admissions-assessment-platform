import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate } from "@/lib/format-date";
import { getSettings } from "@/lib/settings";
import { requireStaff } from "@/lib/staff/session";
import { createClosure, deleteClosure } from "./actions";

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export default async function ClosuresPage() {
  const { supabase } = await requireStaff("settings.write");
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: closures }, { data: campuses }, settings] = await Promise.all([
    supabase.from("school_closures").select("*, campuses(name)").order("starts_on"),
    supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
    getSettings(supabase),
  ]);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  const upcoming = (closures ?? []).filter((c) => c.ends_on >= today);
  const past = (closures ?? []).filter((c) => c.ends_on < today);

  return (
    <>
      <PageTitle
        title="School holidays"
        description="No assessment sittings or visits are created on these dates. Every other weekday gets both, at every campus."
      />

      <section className="mb-4 surface p-4 text-sm">
        <h2 className="mb-1 text-sm font-semibold">The weekday schedule</h2>
        {settings.autoSessionsEnabled ? (
          <p className="text-muted-foreground">
            Every weekday, {settings.autoSessionsWeeksAhead} weeks ahead: an assessment sitting at {clock(settings.autoAssessmentStartMinutes)} for{" "}
            {settings.autoAssessmentDurationMinutes} minutes and a school visit at {clock(settings.autoVisitStartMinutes)} for {settings.autoVisitDurationMinutes} minutes,{" "}
            {settings.autoSessionCapacity} places each. Change these under Workflow settings; the next run of the job queue applies them to days that have no session yet.
          </p>
        ) : (
          <p className="text-muted-foreground">Switched off under Workflow settings (auto_sessions_enabled). Sessions are created by hand.</p>
        )}
      </section>

      <section className="surface p-4">
        <h2 className="mb-2 text-sm font-semibold">Add a closure</h2>
        <ActionForm action={createClosure} label="Add" size="sm" className="grid gap-2 sm:grid-cols-[180px_150px_150px_1fr_auto]">
          <NativeSelect name="campusId" defaultValue="">
            <option value="">All campuses</option>
            {(campuses ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </NativeSelect>
          <Input name="startsOn" type="date" required />
          <Input name="endsOn" type="date" required />
          <Input name="label" placeholder="Mid-term break" required />
        </ActionForm>
        <p className="mt-1 text-xs text-muted-foreground">Order: campus, first day, last day, what it is. A single day has the same first and last day.</p>
      </section>

      <h2 className="mt-6 mb-2 text-sm font-semibold">Coming up</h2>
      {upcoming.length ? (
        <ul className="divide-y divide-border surface text-sm">
          {upcoming.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2">
              <span className="w-56">{formatDate(c.starts_on)}{c.ends_on !== c.starts_on ? ` – ${formatDate(c.ends_on)}` : ""}</span>
              <span className="flex-1">{c.label}</span>
              <span className="text-muted-foreground">{one(c.campuses)?.name ?? "All campuses"}</span>
              <ActionForm action={deleteClosure} label="Remove" size="xs" variant="outline">
                <input type="hidden" name="closureId" value={c.id} />
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>No closures ahead. Every weekday is open.</EmptyState>
      )}

      {past.length ? (
        <>
          <h2 className="mt-6 mb-2 text-sm font-semibold text-muted-foreground">Past</h2>
          <ul className="divide-y divide-border surface text-sm text-muted-foreground">
            {past.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-56">{formatDate(c.starts_on)}{c.ends_on !== c.starts_on ? ` – ${formatDate(c.ends_on)}` : ""}</span>
                <span className="flex-1">{c.label}</span>
                <span>{one(c.campuses)?.name ?? "All campuses"}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
