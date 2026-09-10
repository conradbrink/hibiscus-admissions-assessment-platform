-- Three sitting times a weekday, both kinds at each.
--
-- The school runs its visits and its assessment sittings at 08:00, 09:30 and
-- 11:00. The schedule settings held one start time per kind, so the generator
-- could only ever put one sitting and one visit on a day; the times are lists
-- now, and `planSessions` skips a *time* that already has a session rather
-- than a whole day.
--
-- Minutes after midnight in school time (UTC+2), as before: 480 = 08:00,
-- 570 = 09:30, 660 = 11:00.

insert into public.settings (key, value, description)
values
  ('auto_assessment_starts', '[480, 570, 660]'::jsonb,
   'When the daily assessment sittings start, in minutes after midnight, school time. A sorted list of distinct times; anything else falls back to 08:00, 09:30 and 11:00.'),
  ('auto_visit_starts', '[480, 570, 660]'::jsonb,
   'When the daily school visits start, in minutes after midnight, school time. A sorted list of distinct times; anything else falls back to 08:00, 09:30 and 11:00.')
on conflict (key) do update
  set value = excluded.value, description = excluded.description;

delete from public.settings where key in ('auto_assessment_start_minutes', 'auto_visit_start_minutes');

-- A campus cannot hold two sittings of the same kind at the same instant. The
-- generator's own bookkeeping was the only thing preventing it, and that
-- bookkeeping just changed; two drains overlapping would otherwise duplicate
-- a slot and split its places in two.
create unique index if not exists sessions_slot_idx on public.sessions (campus_id, kind, starts_at);
