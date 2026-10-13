-- A child who arrived is never a no-show.
--
-- A booking moves one of two ways: booked → checked in → in progress →
-- completed, or booked → no-show. The two never cross. Until now nothing held
-- that line: `onNoShow` accepted a booking that was already checked in, and
-- both the applicant page and Today's assessments offered No-show beside a
-- child who had been checked in (and, after an abandoned sitting, beside one
-- who had been launched and handed back). The applicant then read "Arrived"
-- on the timeline and "No-show" on the badge, the funnel counted the same
-- child as attended and as missed, and the family was emailed a rebooking
-- link for an assessment they had come to.
--
-- The application code now refuses the move before it writes anything; this
-- is the backstop, so no other writer can make the two disagree again. A
-- booking that was ever checked in keeps `checked_in_at`, so a row put back to
-- `booked` (a reschedule rolled back) is still recognised as one somebody
-- arrived for. Getting a mistaken check-in off the record is a cancellation,
-- which says what happened, not a no-show, which would not.

create or replace function public.bookings_guard_no_show()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'no_show'
     and old.status is distinct from 'no_show'
     and (old.status <> 'booked' or old.checked_in_at is not null) then
    raise exception 'booking_already_arrived: a booking that was checked in cannot become a no-show'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function public.bookings_guard_no_show() is
  'Refuses no_show on a booking that is not booked, or that was ever checked in. Arrived and no-show are two different ends of a booking, never both.';

-- A trigger function is not an API.
revoke all on function public.bookings_guard_no_show() from public, anon, authenticated;

drop trigger if exists bookings_guard_no_show on public.bookings;
create trigger bookings_guard_no_show
  before update of status on public.bookings
  for each row execute function public.bookings_guard_no_show();
