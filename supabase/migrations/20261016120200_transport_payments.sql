-- School transport, part three: paying for a booking.
--
-- The same payment records as everything else, with a third subject. A
-- request and its payments already name exactly one of two things (an
-- admission, or a child's extras: `20260912080000_student_payments.sql`);
-- they now name one of three. Not a second set of money tables: that would be
-- a second reconciler, a second receipt and a second place to look when a
-- parent says they paid, which is the reason the extras did not get one
-- either.
--
-- One payment per booking, whatever its number of children. Every campus
-- the shuttle serves charges in pula, so one household's basket always adds
-- up — the reason extras are paid per child does not apply here.

-- ---------------------------------------------------------------------------
-- What is owed
-- ---------------------------------------------------------------------------

alter table public.payment_requests
  add column if not exists transport_booking_id uuid references public.transport_bookings(id) on delete restrict;

alter table public.payment_requests drop constraint if exists payment_requests_kind_check;
alter table public.payment_requests add constraint payment_requests_kind_check
  check (kind in ('admission', 'extras', 'transport'));

alter table public.payment_requests drop constraint if exists payment_requests_has_one_subject;
alter table public.payment_requests add constraint payment_requests_has_one_subject
  check (
    (application_id is not null and offer_id is not null and acceptance_id is not null
       and student_id is null and transport_booking_id is null)
    or (student_id is not null
       and application_id is null and offer_id is null and acceptance_id is null and transport_booking_id is null)
    or (transport_booking_id is not null
       and application_id is null and offer_id is null and acceptance_id is null and student_id is null)
  );

-- The kind and the campus follow the subject, as before. A booking's campus
-- is its first child's: a payment row has one campus, and a household with
-- children at two schools still makes one payment. Whoever can see that
-- child's campus can see the payment, which is what the unchanged
-- `payment_requests_select` already asks.
--
-- Re-created whole, so the pinned search path from `20260912230000` is
-- restated here rather than lost.
create or replace function public.payment_requests_set_subject()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.application_id is not null then
    new.kind := 'admission';
    select a.campus_id into new.campus_id from public.applications a where a.id = new.application_id;
  elsif new.student_id is not null then
    new.kind := 'extras';
    select s.current_campus_id into new.campus_id from public.students s where s.id = new.student_id;
  elsif new.transport_booking_id is not null then
    new.kind := 'transport';
    select r.campus_id into new.campus_id
      from public.transport_booking_riders r
     where r.booking_id = new.transport_booking_id
     order by r.position
     limit 1;
  else
    new.campus_id := null;
  end if;
  -- A request nobody can scope is a request nobody should be able to read.
  -- Fails closed: a booking with no children cannot be charged.
  if new.campus_id is null then
    raise exception 'a payment request must resolve to a campus';
  end if;
  return new;
end;
$$;

revoke all on function public.payment_requests_set_subject() from public, anon, authenticated;

drop trigger if exists payment_requests_subject on public.payment_requests;
create trigger payment_requests_subject
  before insert or update of application_id, student_id, transport_booking_id, campus_id, kind
  on public.payment_requests
  for each row execute function public.payment_requests_set_subject();

-- One open request per booking: a second would let a second checkout charge
-- for the same children.
create unique index if not exists payment_requests_one_open_transport_idx
  on public.payment_requests(transport_booking_id)
  where transport_booking_id is not null and status in ('required', 'processing', 'failed', 'partially_paid');

comment on column public.payment_requests.transport_booking_id is
  'The school transport booking this is owed for. Exactly one subject is named: the admission triple, a student, or a transport booking.';
comment on column public.payment_requests.kind is
  'admission | extras | transport. Derived from the subject by payment_requests_set_subject(); never set by a caller.';

-- ---------------------------------------------------------------------------
-- What was attempted and received
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists transport_booking_id uuid references public.transport_bookings(id) on delete restrict;

alter table public.payments drop constraint if exists payments_has_one_subject;
alter table public.payments add constraint payments_has_one_subject
  check (
    (application_id is not null and student_id is null and transport_booking_id is null)
    or (student_id is not null and application_id is null and transport_booking_id is null)
    or (transport_booking_id is not null and application_id is null and student_id is null)
  );

-- A payment's subject is its request's: overwritten, never trusted.
create or replace function public.payments_set_subject()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_request record;
begin
  select application_id, student_id, transport_booking_id, campus_id
    into v_request
    from public.payment_requests
   where id = new.payment_request_id;
  if not found then
    raise exception 'a payment must belong to a payment request';
  end if;
  new.application_id       := v_request.application_id;
  new.student_id           := v_request.student_id;
  new.transport_booking_id := v_request.transport_booking_id;
  new.campus_id            := v_request.campus_id;
  return new;
end;
$$;

revoke all on function public.payments_set_subject() from public, anon, authenticated;

drop trigger if exists payments_subject on public.payments;
create trigger payments_subject
  before insert or update of payment_request_id, application_id, student_id, transport_booking_id, campus_id
  on public.payments
  for each row execute function public.payments_set_subject();

create index if not exists payments_transport_booking_idx
  on public.payments(transport_booking_id) where transport_booking_id is not null;

comment on column public.payments.transport_booking_id is
  'The transport booking this payment is for. Copied from its request by payments_set_subject().';

-- ---------------------------------------------------------------------------
-- A booking's status moves one way
-- ---------------------------------------------------------------------------

-- awaiting_payment → paid, expired, abandoned or cancelled
-- expired, abandoned → paid    (money that arrives late still settles)
-- paid → cancelled             (every child on it cancelled)
--
-- And `paid` only with a paid request behind it. "Paid means verified" holds
-- for an admission because one function writes the status; a booking has no
-- engine, so the database says it instead: nothing marks a booking paid
-- unless the reconciler has already marked its request paid.
create or replace function public.transport_bookings_guard_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not (
       (old.status = 'awaiting_payment' and new.status in ('paid', 'expired', 'abandoned', 'cancelled'))
    or (old.status in ('expired', 'abandoned') and new.status = 'paid')
    or (old.status = 'paid' and new.status = 'cancelled')
  ) then
    raise exception 'transport_booking_status_illegal' using
      detail = format('A transport booking cannot move from %s to %s.', old.status, new.status);
  end if;
  if new.status = 'paid' then
    if not exists (
      select 1 from public.payment_requests pr
       where pr.transport_booking_id = new.id and pr.status = 'paid'
    ) then
      raise exception 'transport_booking_not_paid' using
        detail = 'A booking is paid only once its payment request is.';
    end if;
    new.paid_at := coalesce(new.paid_at, now());
  end if;
  if new.status = 'cancelled' and exists (
    select 1 from public.transport_booking_riders r where r.booking_id = new.id and r.status = 'booked'
  ) then
    raise exception 'transport_booking_has_riders' using
      detail = 'Cancel the children on a booking before the booking itself.';
  end if;
  return new;
end;
$$;

revoke all on function public.transport_bookings_guard_status() from public, anon, authenticated;

drop trigger if exists transport_bookings_guard_status on public.transport_bookings;
create trigger transport_bookings_guard_status
  before update of status on public.transport_bookings
  for each row execute function public.transport_bookings_guard_status();

-- A booking is also born awaiting payment, never paid.
create or replace function public.transport_bookings_born_unpaid()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'awaiting_payment' or new.paid_at is not null then
    raise exception 'transport_booking_born_paid';
  end if;
  return new;
end;
$$;

revoke all on function public.transport_bookings_born_unpaid() from public, anon, authenticated;

drop trigger if exists transport_bookings_born_unpaid on public.transport_bookings;
create trigger transport_bookings_born_unpaid
  before insert on public.transport_bookings
  for each row execute function public.transport_bookings_born_unpaid();

-- ---------------------------------------------------------------------------
-- The emails about a booking
-- ---------------------------------------------------------------------------

-- A transport email carries a parent's name, the children's names and where
-- they live. `email_messages_select` shows a row with neither an application
-- nor a family to every `applications.read` holder at every campus — the
-- branch that exists for the staff digest — so without this column every
-- transport email would land there. It gets its own branch instead, which
-- asks the booking's own policy.
alter table public.email_messages
  add column if not exists transport_booking_id uuid references public.transport_bookings(id) on delete set null;

create index if not exists email_messages_transport_booking_idx
  on public.email_messages(transport_booking_id) where transport_booking_id is not null;

drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages
  for select using (
    (
      (select public.has_permission('applications.read'))
      and (
        (application_id is null and family_id is null and transport_booking_id is null)
        or exists (
          select 1 from public.applications a
          where a.id = email_messages.application_id
            and (select public.can_access_campus(a.campus_id))
        )
      )
    )
    or exists (
      select 1 from public.students s
      where s.family_id = email_messages.family_id
        and (select public.has_permission('students.read'))
        and (select public.can_access_campus(s.current_campus_id))
    )
    or exists (
      select 1 from public.transport_bookings b
      where b.id = email_messages.transport_booking_id
    )
  );

-- The wording itself arrives with the code that sends it. The audience is
-- added now so a template can say who it is for.
alter table public.email_templates drop constraint if exists email_templates_audience_check;
alter table public.email_templates add constraint email_templates_audience_check
  check (audience in ('parent', 'staff', 'family', 'transport'));

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array['payment_requests_set_subject()', 'payments_set_subject()'] loop
    if not exists (
      select 1 from pg_proc p
       where p.oid = ('public.' || v_fn)::regprocedure
         and 'search_path=public, pg_temp' = any (p.proconfig)
    ) then
      raise exception '% lost its pinned search path', v_fn;
    end if;
    if has_function_privilege('authenticated', ('public.' || v_fn)::regprocedure, 'execute') then
      raise exception '% is callable by a signed-in account', v_fn;
    end if;
  end loop;
end
$$;
