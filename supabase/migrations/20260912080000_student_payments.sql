-- Paying for something that is not an admission.
--
-- A family can now choose optional extras — stationery, transport, lunch,
-- aftercare — and the school asked for them to be paid for in the portal.
-- Nothing could charge for them, because both payment records were welded to
-- the admissions funnel: `payment_requests` required an application, an offer
-- *and* an acceptance, `payments` required an application, and both policies
-- reached campus by joining `applications`, so a row with no application was
-- invisible to every member of staff.
--
-- This relaxes those records rather than building a parallel set beside them.
-- A second set of money tables would mean a second reconciler, a second
-- receipt, a second finance queue and two places to look when a parent says
-- they paid. So the subject becomes a choice of two — an application, or a
-- child — and everything downstream of it stays where it is.
--
-- The shape is the one `access_tokens` already uses and that security case 48
-- guards: several nullable subject columns, and a check that exactly one of
-- them is named. `tasks_has_a_subject` did the same for tasks last week.

-- ---------------------------------------------------------------------------
-- What is owed
-- ---------------------------------------------------------------------------

alter table public.payment_requests
  alter column application_id drop not null,
  alter column offer_id       drop not null,
  alter column acceptance_id  drop not null;

alter table public.payment_requests
  add column if not exists student_id uuid references public.students(id) on delete cascade,
  -- Derived from the subject by the trigger below, never typed in: a `kind`
  -- that disagreed with the columns would be worse than no `kind` at all. It
  -- exists so the finance queue can group on a column instead of asking
  -- whether three other columns happen to be null.
  add column if not exists kind text not null default 'admission',
  -- Denormalised so one policy serves both kinds. The precedent is
  -- `tasks.campus_id` and `student_onboarding_items.campus_id`.
  add column if not exists campus_id uuid references public.campuses(id) on delete restrict;

alter table public.payment_requests drop constraint if exists payment_requests_kind_check;
alter table public.payment_requests add constraint payment_requests_kind_check
  check (kind in ('admission', 'extras'));

-- Every existing row is an admission request with a live application, so the
-- backfill is exact and `set not null` cannot fail.
update public.payment_requests r
   set campus_id = a.campus_id
  from public.applications a
 where a.id = r.application_id
   and r.campus_id is null;

alter table public.payment_requests alter column campus_id set not null;

alter table public.payment_requests drop constraint if exists payment_requests_has_one_subject;
alter table public.payment_requests add constraint payment_requests_has_one_subject
  check (
    -- An admission: the whole triple, because a request for fees payable on
    -- acceptance is meaningless without the offer that priced it.
    (application_id is not null and offer_id is not null and acceptance_id is not null and student_id is null)
    -- Or a child, and nothing from the funnel.
    or (student_id is not null and application_id is null and offer_id is null and acceptance_id is null)
  );

-- The campus and the kind follow the subject, whatever was handed in. A forged
-- `campus_id` on an insert or an update is overwritten rather than trusted,
-- which is what stops the rewritten policy below from being talked around.
create or replace function public.payment_requests_set_subject()
returns trigger language plpgsql as $$
begin
  if new.application_id is not null then
    new.kind := 'admission';
    select a.campus_id into new.campus_id from public.applications a where a.id = new.application_id;
  elsif new.student_id is not null then
    new.kind := 'extras';
    select s.current_campus_id into new.campus_id from public.students s where s.id = new.student_id;
  end if;
  -- A request nobody can scope is a request nobody should be able to read.
  -- Fails closed: a child with no campus yet cannot be charged.
  if new.campus_id is null then
    raise exception 'a payment request must resolve to a campus';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_requests_subject on public.payment_requests;
create trigger payment_requests_subject
  before insert or update of application_id, student_id, campus_id, kind
  on public.payment_requests
  for each row execute function public.payment_requests_set_subject();

-- One open request per child, the same rule the funnel has per application.
-- `payment_requests_one_open_idx on (application_id)` needs no change: Postgres
-- treats NULLs as distinct, so extras rows do not collide with each other
-- there.
create unique index if not exists payment_requests_one_open_student_idx
  on public.payment_requests(student_id)
  where student_id is not null and status in ('required', 'processing', 'failed', 'partially_paid');

comment on column public.payment_requests.student_id is
  'The child this is owed for, when it is not an admission. Exactly one subject is named: the application/offer/acceptance triple, or a student.';
comment on column public.payment_requests.kind is
  'admission | extras. Derived from the subject by payment_requests_set_subject(); never set by a caller.';
comment on column public.payment_requests.campus_id is
  'The subject''s campus, denormalised so the read policy needs no join. Trigger-derived, so a forged value cannot widen access.';

-- ---------------------------------------------------------------------------
-- What was attempted and received
-- ---------------------------------------------------------------------------

alter table public.payments
  alter column application_id drop not null;

alter table public.payments
  add column if not exists student_id uuid references public.students(id) on delete cascade,
  add column if not exists campus_id uuid references public.campuses(id) on delete restrict;

update public.payments p
   set campus_id = a.campus_id
  from public.applications a
 where a.id = p.application_id
   and p.campus_id is null;

alter table public.payments alter column campus_id set not null;

alter table public.payments drop constraint if exists payments_has_one_subject;
alter table public.payments add constraint payments_has_one_subject
  check (
    (application_id is not null and student_id is null)
    or (student_id is not null and application_id is null)
  );

-- A payment's subject is its request's subject. Not merely defaulted from it —
-- overwritten, on insert and on any attempt to change it, so a payment can
-- never be scoped to a campus its request is not. `startCheckout` may go on
-- passing `application_id` and it will simply agree.
create or replace function public.payments_set_subject()
returns trigger language plpgsql as $$
declare
  v_request record;
begin
  select application_id, student_id, campus_id
    into v_request
    from public.payment_requests
   where id = new.payment_request_id;
  if not found then
    raise exception 'a payment must belong to a payment request';
  end if;
  new.application_id := v_request.application_id;
  new.student_id     := v_request.student_id;
  new.campus_id      := v_request.campus_id;
  return new;
end;
$$;

drop trigger if exists payments_subject on public.payments;
create trigger payments_subject
  before insert or update of payment_request_id, application_id, student_id, campus_id
  on public.payments
  for each row execute function public.payments_set_subject();

create index if not exists payments_student_idx
  on public.payments(student_id) where student_id is not null;

comment on column public.payments.student_id is
  'The child this payment is for, when it is not an admission. Copied from its request by payments_set_subject().';
comment on column public.payments.campus_id is
  'Its request''s campus, for the read policy. Trigger-derived from the request, never from the caller.';

-- ---------------------------------------------------------------------------
-- The line a payment settled
-- ---------------------------------------------------------------------------

alter table public.student_optional_selections
  add column if not exists payment_request_id uuid references public.payment_requests(id) on delete set null;

create index if not exists optional_selections_request_idx
  on public.student_optional_selections(payment_request_id) where payment_request_id is not null;

comment on column public.student_optional_selections.payment_request_id is
  'What paid for this line. Set when the request is raised, so a family who orders again while the first order is being paid for does not have the second swept into it.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Both policies previously reached campus through `applications`, which no
-- extras row has. They now test the denormalised campus directly, which is the
-- same answer for an admission row — the trigger derives it from the very
-- application the old policy joined — and the only possible answer for a
-- student row.
--
-- The fail-closed property is unchanged and comes from `can_access_campus`
-- itself: a campus-scoped role with no assignment gets false
-- (20260904210000_campus_scope_hardening.sql).

drop policy if exists payment_requests_select on public.payment_requests;
create policy payment_requests_select on public.payment_requests
  for select using (
    ((select public.has_permission('offers.read')) or (select public.has_permission('finance.read')))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select using (
    (select public.has_permission('finance.read'))
    and (select public.can_access_campus(campus_id))
  );
