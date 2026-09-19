import { ActionForm } from "@/components/staff/action-form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EVENT_KIND_LABELS } from "@/lib/crm/labels";
import type { CrmEventRow } from "@/lib/supabase/types";
import { createEvent, updateEvent } from "@/app/staff/(crm)/crm/events/actions";

/** Local wall time for a datetime-local input, from a UTC instant, in the school's zone. */
function localValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 2 * 3_600_000);
  return d.toISOString().slice(0, 16);
}

export function EventForm({ event, campuses, staff }: { event?: CrmEventRow; campuses: Array<{ id: string; name: string }>; staff: Array<{ id: string; full_name: string }> }) {
  return (
    <ActionForm action={event ? updateEvent : createEvent} label={event ? "Save" : "Create event"} size="lg" resetOnSubmit={false} className="surface grid max-w-2xl gap-3 p-5 sm:grid-cols-2">
      {event ? <input type="hidden" name="eventId" value={event.id} /> : null}
      <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Name</span><Input name="name" defaultValue={event?.name ?? ""} required maxLength={160} /></label>
      <label className="text-xs"><span className="mb-1 block text-muted-foreground">Kind</span>
        <NativeSelect name="kind" defaultValue={event?.kind ?? "open_day"}>{Object.entries(EVENT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
      </label>
      <label className="text-xs"><span className="mb-1 block text-muted-foreground">Campus</span>
        <NativeSelect name="campusId" defaultValue={event?.campus_id ?? ""}><option value="">Every campus</option>{campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
      </label>
      <label className="text-xs"><span className="mb-1 block text-muted-foreground">Starts (school time)</span><Input type="datetime-local" name="startsAt" defaultValue={localValue(event?.starts_at ?? null)} required /></label>
      <label className="text-xs"><span className="mb-1 block text-muted-foreground">Ends</span><Input type="datetime-local" name="endsAt" defaultValue={localValue(event?.ends_at ?? null)} /></label>
      <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Location</span><Input name="location" defaultValue={event?.location ?? ""} maxLength={200} /></label>
      <label className="text-xs sm:col-span-2"><span className="mb-1 block text-muted-foreground">Description (parents read this)</span><Textarea name="description" rows={3} defaultValue={event?.description ?? ""} maxLength={2000} /></label>
      <label className="text-xs"><span className="mb-1 block text-muted-foreground">Capacity</span><Input name="capacity" inputMode="numeric" defaultValue={event?.capacity ?? ""} placeholder="No limit" /></label>
      <label className="text-xs"><span className="mb-1 block text-muted-foreground">Staff responsible</span>
        <NativeSelect name="staffId" defaultValue={event?.staff_id ?? ""}><option value="">Nobody yet</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</NativeSelect>
      </label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="registrationOpen" defaultChecked={event?.registration_open ?? true} /> Families may register</label>
      {event ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isCancelled" defaultChecked={event.is_cancelled} /> Cancelled</label> : null}
    </ActionForm>
  );
}
