import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { daysAgoDateString, formatDateLong, formatTime, toSchoolDateString, SCHOOL_TIMEZONE } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { createSessions, deleteSession, setPublished, updateSession } from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** The day a session falls on in the school's zone, as YYYY-MM-DD. */
function schoolDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** The clock time in the school's zone, for the edit form's time input. */
function schoolTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: SCHOOL_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function minutesBetween(a: string, b: string): number {
  return Math.max(15, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000));
}

/**
 * The sessions board. One block per day rather than one long table: the
 * automatic weekday sessions repeat across every campus, so a flat list of
 * four hundred identical-looking rows is the thing that made this page hard
 * to read. Filters narrow it, and each session opens an edit form in place.
 */
export default async function SessionsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ campus?: string; kind?: string; from?: string; booked?: string }>;
}) {
  const filters = await searchParams;
  const { supabase } = await requireStaff("applications.write");
  const from = filters.from || daysAgoDateString(1);

  let query = supabase
    .from("sessions")
    .select("*, campuses(name), staff_profiles!sessions_assessor_staff_id_fkey(full_name)")
    .gte("starts_at", from)
    .order("starts_at")
    .limit(400);
  if (filters.campus) query = query.eq("campus_id", filters.campus);
  if (filters.kind === "assessment" || filters.kind === "visit") query = query.eq("kind", filters.kind);

  const [{ data: sessions }, { data: campuses }, { data: grades }, { data: staff }] = await Promise.all([
    query,
    supabase.from("v_accessible_campuses").select("id, name").order("sort_order"),
    supabase.from("grades").select("id, name, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const ids = (sessions ?? []).map((s) => s.id);
  const { data: taken } = ids.length
    ? await supabase.from("bookings").select("session_id").in("session_id", ids).in("status", ["booked", "checked_in", "in_progress", "completed"])
    : { data: [] };
  const counts = new Map<string, number>();
  for (const b of taken ?? []) counts.set(b.session_id, (counts.get(b.session_id) ?? 0) + 1);

  const shown = (sessions ?? []).filter((s) => (filters.booked === "1" ? (counts.get(s.id) ?? 0) > 0 : true));
  const days = new Map<string, typeof shown>();
  for (const s of shown) {
    const key = schoolDay(s.starts_at);
    days.set(key, [...(days.get(key) ?? []), s]);
  }

  const gradeName = (sort: number | null) => (sort === null ? null : (grades?.find((g) => g.sort_order === sort)?.name ?? String(sort)));
  const gradeRange = (min: number | null, max: number | null) => {
    const a = gradeName(min);
    const b = gradeName(max);
    if (!a && !b) return "Every grade";
    if (a && b) return a === b ? a : `${a} to ${b}`;
    return a ? `${a} and up` : `Up to ${b}`;
  };
  const totalBooked = shown.reduce((n, s) => n + (counts.get(s.id) ?? 0), 0);

  return (
    <>
      <PageTitle
        back={{ href: "/staff/admin", label: "Settings" }}
        title="Sessions"
        description="The dates and times parents can book. Only published sessions are offered. A sitting and a visit are created at each of the school's times, every weekday at every campus, except on the dates under School holidays; add extra sessions here."
      />

      {/* A plain GET form, so a filtered view can be bookmarked or sent to a colleague. */}
      <form className="mb-4 flex flex-wrap items-end gap-3 surface p-3">
        <div className="space-y-1">
          <Label htmlFor="from" className="text-xs">From</Label>
          <Input id="from" name="from" type="date" defaultValue={from.slice(0, 10)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="campus" className="text-xs">Campus</Label>
          <NativeSelect id="campus" name="campus" defaultValue={filters.campus ?? ""} className="h-9">
            <option value="">Every campus</option>
            {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="kind" className="text-xs">Kind</Label>
          <NativeSelect id="kind" name="kind" defaultValue={filters.kind ?? ""} className="h-9">
            <option value="">Both kinds</option>
            <option value="assessment">Assessments</option>
            <option value="visit">School visits</option>
          </NativeSelect>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="booked" value="1" defaultChecked={filters.booked === "1"} /> Only those with bookings
        </label>
        <Button type="submit" size="sm" variant="outline">Show</Button>
        <p className="ml-auto text-xs text-muted-foreground">
          {shown.length} session{shown.length === 1 ? "" : "s"} · {totalBooked} booked
        </p>
      </form>

      <details className="mb-6 surface p-4">
        <summary className="cursor-pointer text-sm font-semibold">Add sessions</summary>
        <ActionForm action={createSessions} label="Create" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="kindNew">Kind</Label>
            <NativeSelect id="kindNew" name="kind" defaultValue="assessment">
              <option value="assessment">Assessment</option>
              <option value="visit">School visit</option>
            </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="campusId">Campus</Label>
            <NativeSelect id="campusId" name="campusId" required>
              {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="date">Date</Label><Input id="date" name="date" type="date" defaultValue={toSchoolDateString(new Date())} required /></div>
          <div className="space-y-1"><Label htmlFor="startTime">Start</Label><Input id="startTime" name="startTime" type="time" defaultValue="08:00" required /></div>
          <div className="space-y-1"><Label htmlFor="durationMinutes">Duration (min)</Label><Input id="durationMinutes" name="durationMinutes" type="number" defaultValue={90} min={15} max={480} required /></div>
          <div className="space-y-1"><Label htmlFor="capacity">Places</Label><Input id="capacity" name="capacity" type="number" defaultValue={6} min={1} required /></div>
          <div className="space-y-1"><Label htmlFor="minGradeSort">From grade</Label>
            <NativeSelect id="minGradeSort" name="minGradeSort" defaultValue="">
              <option value="">Any</option>
              {(grades ?? []).map((g) => <option key={g.id} value={g.sort_order}>{g.name}</option>)}
            </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="maxGradeSort">To grade</Label>
            <NativeSelect id="maxGradeSort" name="maxGradeSort" defaultValue="">
              <option value="">Any</option>
              {(grades ?? []).map((g) => <option key={g.id} value={g.sort_order}>{g.name}</option>)}
            </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="assessorStaffId">Assessor</Label>
            <NativeSelect id="assessorStaffId" name="assessorStaffId" defaultValue="">
              <option value="">Not set</option>
              {(staff ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="location">Location</Label><Input id="location" name="location" placeholder="Computer lab, Block 7" /></div>
          <div className="space-y-1"><Label htmlFor="repeatWeeks">Repeat weekly for</Label><Input id="repeatWeeks" name="repeatWeeks" type="number" defaultValue={1} min={1} max={12} /></div>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="publish" value="1" defaultChecked /> Publish immediately</label>
        </ActionForm>
      </details>

      {days.size ? (
        <div className="space-y-6">
          {[...days.entries()].map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-semibold">
                {formatDateLong(`${day}T12:00:00Z`)}
                <span className="ml-2 font-normal text-muted-foreground">
                  {list.length} session{list.length === 1 ? "" : "s"}
                </span>
              </h2>
              <ul className="divide-y divide-border surface">
                {list.map((s) => {
                  const n = counts.get(s.id) ?? 0;
                  const full = n >= s.capacity;
                  return (
                    <li key={s.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <p className="w-28 shrink-0 font-mono text-sm font-semibold tabular-nums">
                          {formatTime(s.starts_at)}–{formatTime(s.ends_at)}
                        </p>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">
                            {one(s.campuses)?.name}
                            <span className="ml-2 font-normal text-muted-foreground">
                              {s.kind === "assessment" ? "Assessment" : "School visit"}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {gradeRange(s.min_grade_sort, s.max_grade_sort)}
                            {s.location ? ` · ${s.location}` : ""}
                            {one(s.staff_profiles)?.full_name ? ` · ${one(s.staff_profiles)?.full_name}` : ""}
                          </p>
                        </div>
                        <p className={`shrink-0 text-sm tabular-nums ${full ? "font-semibold text-warning-foreground" : "text-muted-foreground"}`}>
                          {n} of {s.capacity} booked
                        </p>
                        {s.is_published ? <Badge variant="success">Published</Badge> : <Badge variant="muted">Draft</Badge>}
                        <div className="flex shrink-0 gap-1.5">
                          <ActionForm action={setPublished} label={s.is_published ? "Unpublish" : "Publish"} size="xs" variant="outline">
                            <input type="hidden" name="sessionId" value={s.id} />
                            <input type="hidden" name="published" value={s.is_published ? "0" : "1"} />
                          </ActionForm>
                          {n === 0 ? (
                            <ActionForm action={deleteSession} label="Delete" size="xs" variant="ghost" confirm="Delete this session?">
                              <input type="hidden" name="sessionId" value={s.id} />
                            </ActionForm>
                          ) : null}
                        </div>
                      </div>

                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-primary">Edit</summary>
                        <ActionForm action={updateSession} label="Save changes" size="sm" className="mt-2 grid gap-3 rounded-lg bg-muted/40 p-3 sm:grid-cols-3 lg:grid-cols-4">
                          <input type="hidden" name="sessionId" value={s.id} />
                          <div className="space-y-1"><Label htmlFor={`d-${s.id}`} className="text-xs">Date</Label>
                            <Input id={`d-${s.id}`} name="date" type="date" defaultValue={schoolDay(s.starts_at)} required /></div>
                          <div className="space-y-1"><Label htmlFor={`t-${s.id}`} className="text-xs">Start</Label>
                            <Input id={`t-${s.id}`} name="startTime" type="time" defaultValue={schoolTime(s.starts_at)} required /></div>
                          <div className="space-y-1"><Label htmlFor={`m-${s.id}`} className="text-xs">Duration (min)</Label>
                            <Input id={`m-${s.id}`} name="durationMinutes" type="number" min={15} max={480} defaultValue={minutesBetween(s.starts_at, s.ends_at)} required /></div>
                          <div className="space-y-1"><Label htmlFor={`c-${s.id}`} className="text-xs">Places</Label>
                            <Input id={`c-${s.id}`} name="capacity" type="number" min={Math.max(1, n)} defaultValue={s.capacity} required /></div>
                          <div className="space-y-1"><Label htmlFor={`gmin-${s.id}`} className="text-xs">From grade</Label>
                            <NativeSelect id={`gmin-${s.id}`} name="minGradeSort" defaultValue={s.min_grade_sort ?? ""}>
                              <option value="">Any</option>
                              {(grades ?? []).map((g) => <option key={g.id} value={g.sort_order}>{g.name}</option>)}
                            </NativeSelect></div>
                          <div className="space-y-1"><Label htmlFor={`gmax-${s.id}`} className="text-xs">To grade</Label>
                            <NativeSelect id={`gmax-${s.id}`} name="maxGradeSort" defaultValue={s.max_grade_sort ?? ""}>
                              <option value="">Any</option>
                              {(grades ?? []).map((g) => <option key={g.id} value={g.sort_order}>{g.name}</option>)}
                            </NativeSelect></div>
                          <div className="space-y-1"><Label htmlFor={`a-${s.id}`} className="text-xs">Assessor</Label>
                            <NativeSelect id={`a-${s.id}`} name="assessorStaffId" defaultValue={s.assessor_staff_id ?? ""}>
                              <option value="">Not set</option>
                              {(staff ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                            </NativeSelect></div>
                          <div className="space-y-1"><Label htmlFor={`l-${s.id}`} className="text-xs">Location</Label>
                            <Input id={`l-${s.id}`} name="location" defaultValue={s.location ?? ""} placeholder="Computer lab, Block 7" /></div>
                        </ActionForm>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState>
          {sessions?.length ? "No sessions match those filters." : "No upcoming sessions. Parents cannot book until one is published."}
        </EmptyState>
      )}
    </>
  );
}
