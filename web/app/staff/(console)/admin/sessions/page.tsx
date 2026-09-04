import { ActionForm } from "@/components/staff/action-form";
import { PageTitle, EmptyState } from "@/components/staff/page-title";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { daysAgoDateString, formatDateTime, formatTime, toSchoolDateString } from "@/lib/format-date";
import { requireStaff } from "@/lib/staff/session";
import { createSessions, deleteSession, setPublished } from "./actions";

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export default async function SessionsAdminPage() {
  const { supabase } = await requireStaff("applications.write");
  const [{ data: sessions }, { data: campuses }, { data: grades }, { data: staff }] = await Promise.all([
    supabase
      .from("sessions")
      .select("*, campuses(name), staff_profiles!sessions_assessor_staff_id_fkey(full_name)")
      .gte("starts_at", daysAgoDateString(1))
      .order("starts_at")
      .limit(200),
    supabase.from("campuses").select("id, name").eq("is_active", true).order("sort_order"),
    supabase.from("grades").select("id, name, sort_order").eq("is_active", true).order("sort_order"),
    supabase.from("staff_profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const ids = (sessions ?? []).map((s) => s.id);
  const { data: taken } = ids.length
    ? await supabase.from("bookings").select("session_id").in("session_id", ids).in("status", ["booked", "checked_in", "in_progress", "completed"])
    : { data: [] };
  const counts = new Map<string, number>();
  for (const b of taken ?? []) counts.set(b.session_id, (counts.get(b.session_id) ?? 0) + 1);

  return (
    <>
      <PageTitle title="Sessions" description="The dates and times parents can book. Only published sessions are offered." />

      <section className="mb-6 rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Add sessions</h2>
        <ActionForm action={createSessions} label="Create" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="kind">Kind</Label>
            <NativeSelect id="kind" name="kind" defaultValue="assessment">
              <option value="assessment">Assessment</option>
              <option value="visit">School visit</option>
            </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="campusId">Campus</Label>
            <NativeSelect id="campusId" name="campusId" required>
              {(campuses ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="date">Date</Label><Input id="date" name="date" type="date" defaultValue={toSchoolDateString(new Date())} required /></div>
          <div className="space-y-1"><Label htmlFor="startTime">Start</Label><Input id="startTime" name="startTime" type="time" defaultValue="09:00" required /></div>
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
      </section>

      {sessions && sessions.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Campus</th>
                <th className="px-3 py-2 font-medium">Grades</th>
                <th className="px-3 py-2 font-medium">Booked</th>
                <th className="px-3 py-2 font-medium">Assessor</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((s) => {
                const n = counts.get(s.id) ?? 0;
                const gname = (sort: number | null) => (sort === null ? "any" : grades?.find((g) => g.sort_order === sort)?.name ?? sort);
                return (
                  <tr key={s.id}>
                    <td className="px-3 py-2">{formatDateTime(s.starts_at)}–{formatTime(s.ends_at)}{s.location ? <span className="block text-xs text-muted-foreground">{s.location}</span> : null}</td>
                    <td className="px-3 py-2">{s.kind}</td>
                    <td className="px-3 py-2">{one(s.campuses)?.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{gname(s.min_grade_sort)} – {gname(s.max_grade_sort)}</td>
                    <td className="px-3 py-2 tabular-nums">{n}/{s.capacity}</td>
                    <td className="px-3 py-2 text-muted-foreground">{one(s.staff_profiles)?.full_name ?? "—"}</td>
                    <td className="px-3 py-2">{s.is_published ? <Badge variant="success">Published</Badge> : <Badge variant="muted">Draft</Badge>}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1.5">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState>No upcoming sessions. Parents cannot book until one is published.</EmptyState>
      )}
    </>
  );
}
