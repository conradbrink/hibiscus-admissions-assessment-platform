-- School transport, part two: a booking, its children, and what each costs.
--
-- A booking is one household for one period: the parent's details, the home
-- address, and one to six children, each with a school, a grade, a service
-- and the weekdays. It is typed in by a parent on a public page, so nobody
-- here is a database principal and nothing about it is trusted until this
-- file has checked it.
--
-- The price of each child is worked out here, in `create_transport_booking`,
-- and written onto the child's row as a snapshot: the tariff's figures, the
-- household rate it used and the amounts. The app shows an estimate while the
-- parent types (`lib/transport/pricing.ts`, the same rule pinned to the same
-- figures from the sheet), but what is charged is what this function wrote.
-- Changing a tariff afterwards changes nothing a parent was shown.
--
-- The rule, per child, in whole thebe:
--
--   d = weekdays chosen (1 to 5), m = 1 for a term or 3 for a month
--   parent pays     = round_half_up(term price × d / (5 × m))
--   Watermark gets  = round_half_up(list × (1 − rebate) × (1 + VAT) × d / (5 × m))
--   Hibiscus keeps  = the difference
--
-- Rounded once, on the child's line. Totals are sums of lines and are never
-- rounded again. A term booking for one child in Gaborone, every day, full
-- shuttle: P 4,600.00 to the school, P 4,021.92 to Watermark, P 578.08 kept.

-- ---------------------------------------------------------------------------
-- References
-- ---------------------------------------------------------------------------

create sequence if not exists public.transport_booking_seq;

-- HTR-2027-00042: what the parent quotes and what goes to the gateway. The
-- booking's own reference rather than a child's name, so no child's name is
-- sent to the gateway or kept in its replies.
create or replace function public.next_transport_reference()
returns text
language sql
volatile
security invoker
set search_path = public, pg_temp
as $$
  select format('HTR-%s-%s',
    extract(year from now() at time zone 'Africa/Gaborone')::int,
    lpad(nextval('public.transport_booking_seq')::text, 5, '0'))
$$;

revoke all on function public.next_transport_reference() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The booking
-- ---------------------------------------------------------------------------

create table if not exists public.transport_bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  period_id uuid not null references public.transport_periods(id) on delete restrict,
  provider_id uuid not null references public.transport_providers(id) on delete restrict,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'paid', 'expired', 'abandoned', 'cancelled')),

  -- The parent. Not a `contacts` row: the form is anonymous, and matching it
  -- to a family by the email typed into it is exactly what `/join` refuses to
  -- do for a stranger (`trustedForContact`). Nullable mobile so retention can
  -- remove it; the booking function requires one.
  parent_first_name text not null check (char_length(parent_first_name) between 1 and 100),
  parent_last_name text not null check (char_length(parent_last_name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  email_normalised text not null check (char_length(email_normalised) between 3 and 254),
  mobile text check (mobile is null or mobile ~ '^\+[1-9][0-9]{6,14}$'),
  second_contact_name text check (second_contact_name is null or char_length(second_contact_name) <= 120),
  second_contact_mobile text check (second_contact_mobile is null or second_contact_mobile ~ '^\+[1-9][0-9]{6,14}$'),

  -- Where the children are collected. The zone is copied from the area when
  -- the booking is made: it decided the price, and moving an area to another
  -- zone later must not re-price a booking that was paid.
  area_id uuid not null references public.transport_areas(id) on delete restrict,
  zone_id uuid not null references public.transport_zones(id) on delete restrict,
  address_line text not null check (char_length(address_line) between 1 and 300),
  landmark text check (landmark is null or char_length(landmark) <= 300),
  notes text check (notes is null or char_length(notes) <= 1000),

  -- What the parent agreed to, and from where.
  terms_id uuid not null references public.transport_terms(id) on delete restrict,
  terms_hash text not null,
  terms_accepted_at timestamptz not null,
  ip_hash text,
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),

  paid_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.staff_profiles(id) on delete set null,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  anonymised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transport_bookings_period_idx on public.transport_bookings(period_id, status);
create index if not exists transport_bookings_email_idx on public.transport_bookings(email_normalised);

drop trigger if exists transport_bookings_set_updated_at on public.transport_bookings;
create trigger transport_bookings_set_updated_at
  before update on public.transport_bookings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The children on it
-- ---------------------------------------------------------------------------

create table if not exists public.transport_booking_riders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.transport_bookings(id) on delete cascade,
  -- The order the parent typed them in. Position 1 decides which campus the
  -- payment is filed under (`payment_requests_set_subject`).
  position smallint not null check (position between 1 and 6),
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  grade_id uuid not null references public.grades(id) on delete restrict,
  -- The school: where the child is dropped and collected. Also what a member
  -- of staff's campus scope is tested against.
  campus_id uuid not null references public.campuses(id) on delete restrict,
  -- Collected in the morning and brought home (`full`), or one of the two.
  service text not null check (service in ('full', 'am', 'pm')),
  mon boolean not null default false,
  tue boolean not null default false,
  wed boolean not null default false,
  thu boolean not null default false,
  fri boolean not null default false,
  days_count smallint generated always as (mon::int + tue::int + wed::int + thu::int + fri::int) stored,

  -- The snapshot: which rate and tariff priced this child, and the figures
  -- as they were. Never recomputed.
  household text not null check (household in ('single', 'different_schools', 'same_school')),
  tariff_id uuid not null references public.transport_tariffs(id) on delete restrict,
  customer_term_minor bigint not null check (customer_term_minor > 0),
  provider_list_term_minor bigint not null check (provider_list_term_minor > 0),
  rebate_bp int not null check (rebate_bp between 0 and 9999),
  vat_bp int not null check (vat_bp between 0 and 10000),
  -- 1 for a term, the term's months for a month.
  period_divisor smallint not null check (period_divisor between 1 and 12),
  amount_minor bigint not null check (amount_minor > 0),
  provider_amount_minor bigint not null check (provider_amount_minor > 0),
  notes text check (notes is null or char_length(notes) <= 500),

  status text not null default 'booked' check (status in ('booked', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references public.staff_profiles(id) on delete set null,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  -- Recorded by finance after the money went back through the gateway's own
  -- portal. Cumulative, and never more than the child's line.
  refund_minor bigint not null default 0,
  refunded_at timestamptz,
  refunded_by uuid references public.staff_profiles(id) on delete set null,
  refund_note text check (refund_note is null or char_length(refund_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, position),
  check (mon or tue or wed or thu or fri),
  check (refund_minor >= 0 and refund_minor <= amount_minor),
  check (provider_amount_minor <= amount_minor),
  -- The rule above, held by the row itself, so a line can never claim a
  -- figure its own snapshot does not produce. rhu(p, q) = (2p + q) div 2q.
  check (amount_minor =
    (2 * customer_term_minor * days_count + 5 * period_divisor) / (10 * period_divisor)),
  check (provider_amount_minor =
    (2 * provider_list_term_minor * (10000 - rebate_bp) * (10000 + vat_bp) * days_count
       + 500000000::bigint * period_divisor)
    / (1000000000::bigint * period_divisor))
);

create index if not exists transport_riders_booking_idx on public.transport_booking_riders(booking_id);
create index if not exists transport_riders_campus_idx on public.transport_booking_riders(campus_id, status);

drop trigger if exists transport_booking_riders_set_updated_at on public.transport_booking_riders;
create trigger transport_booking_riders_set_updated_at
  before update on public.transport_booking_riders
  for each row execute function public.set_updated_at();

-- A child's line is a price that was shown and paid. Who the child is, what
-- they booked and what it cost are frozen; what can change is whether the
-- line is cancelled and what was refunded. Retention is the one writer that
-- may blank the names, and it says so through `app.anonymising_transport`,
-- the same way `delete_application()` announces itself.
create or replace function public.transport_riders_freeze()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_anonymising boolean := coalesce(current_setting('app.anonymising_transport', true), '') = 'on';
begin
  if new.booking_id is distinct from old.booking_id
     or new.position is distinct from old.position
     or new.grade_id is distinct from old.grade_id
     or new.campus_id is distinct from old.campus_id
     or new.service is distinct from old.service
     or (new.mon, new.tue, new.wed, new.thu, new.fri) is distinct from (old.mon, old.tue, old.wed, old.thu, old.fri)
     or new.household is distinct from old.household
     or new.tariff_id is distinct from old.tariff_id
     or new.customer_term_minor is distinct from old.customer_term_minor
     or new.provider_list_term_minor is distinct from old.provider_list_term_minor
     or new.rebate_bp is distinct from old.rebate_bp
     or new.vat_bp is distinct from old.vat_bp
     or new.period_divisor is distinct from old.period_divisor
     or new.amount_minor is distinct from old.amount_minor
     or new.provider_amount_minor is distinct from old.provider_amount_minor then
    raise exception 'transport_rider_frozen' using
      detail = 'A child''s booked service and price cannot be changed. Cancel the line and book again.';
  end if;
  if not v_anonymising
     and (new.first_name is distinct from old.first_name
          or new.last_name is distinct from old.last_name
          or new.notes is distinct from old.notes) then
    raise exception 'transport_rider_frozen' using
      detail = 'A child''s name on a booking is changed only by retention.';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'transport_rider_frozen' using detail = 'A cancelled line stays cancelled.';
  end if;
  return new;
end;
$$;

revoke all on function public.transport_riders_freeze() from public, anon, authenticated;

drop trigger if exists transport_riders_freeze on public.transport_booking_riders;
create trigger transport_riders_freeze
  before update on public.transport_booking_riders
  for each row execute function public.transport_riders_freeze();

-- The booking's priced facts are frozen the same way. The contact details are
-- not: a mistyped mobile is corrected rather than re-booked.
create or replace function public.transport_bookings_freeze()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.reference is distinct from old.reference
     or new.period_id is distinct from old.period_id
     or new.provider_id is distinct from old.provider_id
     or new.area_id is distinct from old.area_id
     or new.zone_id is distinct from old.zone_id
     or new.terms_id is distinct from old.terms_id
     or new.terms_hash is distinct from old.terms_hash
     or new.terms_accepted_at is distinct from old.terms_accepted_at then
    raise exception 'transport_booking_frozen' using
      detail = 'The period, area and terms of a booking priced it and cannot be changed.';
  end if;
  return new;
end;
$$;

revoke all on function public.transport_bookings_freeze() from public, anon, authenticated;

drop trigger if exists transport_bookings_freeze on public.transport_bookings;
create trigger transport_bookings_freeze
  before update on public.transport_bookings
  for each row execute function public.transport_bookings_freeze();

-- ---------------------------------------------------------------------------
-- Making a booking
-- ---------------------------------------------------------------------------

-- Called by the public booking page under the service role, never by staff
-- and never by a browser. Everything the parent typed is checked here against
-- what is open, active and offered, and each child is priced.
--
-- p_booking: { period_id, area_id, terms_id, terms_hash, parent_first_name,
--   parent_last_name, email, email_normalised, mobile, second_contact_name?,
--   second_contact_mobile?, address_line, landmark?, notes?, ip_hash?,
--   user_agent? }
-- p_riders: [{ first_name, last_name, grade_id, campus_id, service,
--   mon, tue, wed, thu, fri, notes? }, ...] in the order typed.
--
-- Errors are short codes the page turns into words, the convention the CRM
-- functions use.
create or replace function public.create_transport_booking(p_booking jsonb, p_riders jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Africa/Gaborone')::date;
  v_period record;
  v_list record;
  v_area record;
  v_terms record;
  v_booking_id uuid;
  v_count int;
  v_rider jsonb;
  v_position int := 0;
  v_campus uuid;
  v_grade uuid;
  v_service text;
  v_household text;
  v_tariff record;
  v_days int;
  v_divisor int;
  v_mobile text;
begin
  if coalesce((select value from public.settings where key = 'transport_booking_enabled'), 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'transport_booking_closed';
  end if;

  if jsonb_typeof(p_riders) <> 'array' then
    raise exception 'transport_riders_invalid';
  end if;
  v_count := jsonb_array_length(p_riders);
  if v_count < 1 or v_count > 6 then
    raise exception 'transport_riders_count';
  end if;

  select * into v_period from public.transport_periods where id = (p_booking->>'period_id')::uuid;
  if not found or not v_period.is_published then
    raise exception 'transport_period_not_open';
  end if;
  if v_today < v_period.booking_opens_on or v_today > v_period.booking_closes_on then
    raise exception 'transport_period_not_open';
  end if;
  -- A month of an unpublished term is not open either.
  if v_period.kind = 'month'
     and not exists (select 1 from public.transport_periods t where t.id = v_period.term_period_id and t.is_published) then
    raise exception 'transport_period_not_open';
  end if;
  v_divisor := case when v_period.kind = 'month' then v_period.billing_months else 1 end;

  select * into v_list from public.transport_price_lists where id = v_period.price_list_id;

  select a.id, a.zone_id into v_area
    from public.transport_areas a
    join public.transport_zones z on z.id = a.zone_id
   where a.id = (p_booking->>'area_id')::uuid and a.is_active and z.is_active;
  if not found then
    raise exception 'transport_area_not_served';
  end if;

  select id, body_hash into v_terms from public.transport_terms
   where id = public.current_transport_terms_id();
  -- `is distinct from`, not `<>`: a missing terms id or hash compares as
  -- null, and `<>` would let a booking through as if its parent had agreed.
  if not found
     or v_terms.id is distinct from (p_booking->>'terms_id')::uuid
     or v_terms.body_hash is distinct from (p_booking->>'terms_hash') then
    raise exception 'transport_terms_changed';
  end if;

  v_mobile := nullif(trim(p_booking->>'mobile'), '');
  if v_mobile is null then
    raise exception 'transport_mobile_required';
  end if;

  -- Every child at an active Botswana campus that offers their grade. A
  -- parent picks from lists, but the lists are the browser's, not ours.
  for v_rider in select * from jsonb_array_elements(p_riders) loop
    v_campus := (v_rider->>'campus_id')::uuid;
    v_grade := (v_rider->>'grade_id')::uuid;
    if not exists (
      select 1 from public.campuses c
       where c.id = v_campus and c.is_active and c.country = 'BW' and c.currency = v_list.currency
    ) then
      raise exception 'transport_campus_not_served';
    end if;
    if not exists (
      select 1 from public.campus_grades cg
       where cg.campus_id = v_campus and cg.grade_id = v_grade and cg.is_active
    ) then
      raise exception 'transport_grade_not_at_campus';
    end if;
    if coalesce(v_rider->>'service', '') not in ('full', 'am', 'pm') then
      raise exception 'transport_service_invalid';
    end if;
  end loop;

  insert into public.transport_bookings (
    reference, period_id, provider_id, status,
    parent_first_name, parent_last_name, email, email_normalised, mobile,
    second_contact_name, second_contact_mobile,
    area_id, zone_id, address_line, landmark, notes,
    terms_id, terms_hash, terms_accepted_at, ip_hash, user_agent
  ) values (
    public.next_transport_reference(), v_period.id, v_list.provider_id, 'awaiting_payment',
    trim(p_booking->>'parent_first_name'), trim(p_booking->>'parent_last_name'),
    trim(p_booking->>'email'), lower(trim(p_booking->>'email_normalised')), v_mobile,
    nullif(trim(p_booking->>'second_contact_name'), ''), nullif(trim(p_booking->>'second_contact_mobile'), ''),
    v_area.id, v_area.zone_id, trim(p_booking->>'address_line'),
    nullif(trim(p_booking->>'landmark'), ''), nullif(trim(p_booking->>'notes'), ''),
    v_terms.id, v_terms.body_hash, now(), nullif(p_booking->>'ip_hash', ''), nullif(p_booking->>'user_agent', '')
  )
  returning id into v_booking_id;

  for v_rider in select * from jsonb_array_elements(p_riders) loop
    v_position := v_position + 1;
    v_campus := (v_rider->>'campus_id')::uuid;
    v_service := v_rider->>'service';

    -- The sibling rate, per child: one child alone; otherwise whether another
    -- child on this booking goes to the same school.
    if v_count = 1 then
      v_household := 'single';
    elsif (select count(*) from jsonb_array_elements(p_riders) x where (x->>'campus_id')::uuid = v_campus) > 1 then
      v_household := 'same_school';
    else
      v_household := 'different_schools';
    end if;

    select t.* into v_tariff
      from public.transport_tariffs t
     where t.price_list_id = v_period.price_list_id
       and t.zone_id = v_area.zone_id
       and t.service = case when v_service = 'full' then 'full' else 'one_way' end
       and t.household = v_household;
    if not found then
      raise exception 'transport_no_tariff';
    end if;

    v_days := coalesce((v_rider->>'mon')::boolean, false)::int + coalesce((v_rider->>'tue')::boolean, false)::int
            + coalesce((v_rider->>'wed')::boolean, false)::int + coalesce((v_rider->>'thu')::boolean, false)::int
            + coalesce((v_rider->>'fri')::boolean, false)::int;
    if v_days < 1 then
      raise exception 'transport_days_required';
    end if;

    insert into public.transport_booking_riders (
      booking_id, position, first_name, last_name, grade_id, campus_id, service,
      mon, tue, wed, thu, fri,
      household, tariff_id, customer_term_minor, provider_list_term_minor, rebate_bp, vat_bp, period_divisor,
      amount_minor, provider_amount_minor, notes
    ) values (
      v_booking_id, v_position, trim(v_rider->>'first_name'), trim(v_rider->>'last_name'),
      (v_rider->>'grade_id')::uuid, v_campus, v_service,
      coalesce((v_rider->>'mon')::boolean, false), coalesce((v_rider->>'tue')::boolean, false),
      coalesce((v_rider->>'wed')::boolean, false), coalesce((v_rider->>'thu')::boolean, false),
      coalesce((v_rider->>'fri')::boolean, false),
      v_household, v_tariff.id, v_tariff.customer_term_minor, v_tariff.provider_list_term_minor,
      v_list.rebate_bp, v_list.vat_bp, v_divisor,
      (2 * v_tariff.customer_term_minor * v_days + 5 * v_divisor) / (10 * v_divisor),
      (2 * v_tariff.provider_list_term_minor * (10000 - v_list.rebate_bp) * (10000 + v_list.vat_bp) * v_days
         + 500000000::bigint * v_divisor) / (1000000000::bigint * v_divisor),
      nullif(trim(v_rider->>'notes'), '')
    );
  end loop;

  return v_booking_id;
end;
$$;

revoke all on function public.create_transport_booking(jsonb, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A task can be about a booking
-- ---------------------------------------------------------------------------

-- A payment that arrives for a cancelled booking, a part payment, an amount
-- that does not match: each needs a person, and each becomes a task. The
-- task's campus is the first child's, which already satisfies
-- `tasks_has_a_subject`; the booking id is what links it back.
alter table public.tasks
  add column if not exists transport_booking_id uuid references public.transport_bookings(id) on delete cascade;

create index if not exists tasks_transport_booking_idx
  on public.tasks(transport_booking_id) where transport_booking_id is not null;

-- A transport coordinator holds no admissions permission, and still has to
-- see the tasks about bookings. Everyone else's view is unchanged.
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    (
      (select public.has_permission('applications.read'))
      or (transport_booking_id is not null and (select public.has_permission('transport.read')))
    )
    and (campus_id is null or (select public.can_access_campus(campus_id)))
  );

-- ---------------------------------------------------------------------------
-- Staff: cancelling, and recording a refund
-- ---------------------------------------------------------------------------

-- Cancel children on a booking, or the whole of an unpaid one.
--
-- An unpaid booking is cancelled whole (null or every rider), along with its
-- open payment request: cancelling one child would leave a request for an
-- amount nobody now owes. A paid booking can lose any of its children, and
-- becomes cancelled when the last one goes; the money goes back separately
-- (`transport_record_refund`), because cancelling and refunding are different
-- decisions made by different people.
--
-- Refused while a payment is being made: the parent may be on the gateway's
-- page paying for the very children being cancelled.
create or replace function public.transport_cancel_riders(p_booking_id uuid, p_rider_ids uuid[], p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
  v_booking record;
  v_ids uuid[];
  v_left int;
begin
  if v_actor is null or not public.has_permission('transport.manage') then
    raise exception 'permission_denied';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'transport_reason_required';
  end if;

  select * into v_booking from public.transport_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'transport_booking_not_found';
  end if;
  -- Every child on the booking must be one this person may see: a
  -- Broadhurst coordinator does not cancel a Block 7 child's place.
  if exists (
    select 1 from public.transport_booking_riders r
     where r.booking_id = p_booking_id and not public.can_access_campus(r.campus_id)
  ) then
    raise exception 'transport_booking_not_allowed';
  end if;
  if exists (
    select 1 from public.payments p
     where p.transport_booking_id = p_booking_id and p.status in ('pending', 'processing')
  ) then
    raise exception 'transport_payment_in_progress';
  end if;

  select coalesce(array_agg(r.id), '{}') into v_ids
    from public.transport_booking_riders r
   where r.booking_id = p_booking_id and r.status = 'booked'
     and (p_rider_ids is null or r.id = any (p_rider_ids));
  if p_rider_ids is not null and cardinality(v_ids) <> (select count(distinct x) from unnest(p_rider_ids) x) then
    raise exception 'transport_rider_not_on_booking';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'transport_nothing_to_cancel';
  end if;

  if v_booking.status = 'awaiting_payment'
     and exists (select 1 from public.transport_booking_riders r
                  where r.booking_id = p_booking_id and r.status = 'booked' and not (r.id = any (v_ids))) then
    raise exception 'transport_unpaid_cancel_whole';
  end if;
  if v_booking.status not in ('awaiting_payment', 'paid') then
    raise exception 'transport_booking_not_cancellable';
  end if;

  update public.transport_booking_riders
     set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor, cancel_reason = trim(p_reason)
   where id = any (v_ids);

  select count(*) into v_left from public.transport_booking_riders where booking_id = p_booking_id and status = 'booked';
  if v_left = 0 then
    update public.transport_bookings
       set status = 'cancelled', cancelled_at = now(), cancelled_by = v_actor, cancel_reason = trim(p_reason)
     where id = p_booking_id;
    update public.payment_requests
       set status = 'cancelled'
     where transport_booking_id = p_booking_id
       and status in ('required', 'failed');
  end if;

  select email into v_label from public.staff_profiles where id = v_actor;
  -- Ids and the reference only. Audit rows with no application or family are
  -- readable by every `audit.read` holder, so no name goes in.
  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, after)
  values ('staff', v_actor, coalesce(v_label, 'Staff'), 'transport.riders_cancelled', 'transport_booking', p_booking_id,
          jsonb_build_object('reference', v_booking.reference, 'rider_ids', to_jsonb(v_ids), 'booking_cancelled', v_left = 0));
end;
$$;

revoke all on function public.transport_cancel_riders(uuid, uuid[], text) from public, anon;
grant execute on function public.transport_cancel_riders(uuid, uuid[], text) to authenticated;

-- What finance gave back for a cancelled child, after doing it in the
-- gateway's own portal. Recorded, not sent: nothing here moves money.
create or replace function public.transport_record_refund(p_rider_id uuid, p_amount_minor bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
  v_rider record;
  v_reference text;
begin
  if v_actor is null or not public.has_permission('transport.finance') or not public.has_permission('finance.write') then
    raise exception 'permission_denied';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'transport_refund_amount';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'transport_reason_required';
  end if;

  select r.*, b.status as booking_status, b.reference into v_rider
    from public.transport_booking_riders r
    join public.transport_bookings b on b.id = r.booking_id
   where r.id = p_rider_id
   for update of r;
  if not found then
    raise exception 'transport_rider_not_found';
  end if;
  if not public.can_access_campus(v_rider.campus_id) then
    raise exception 'transport_booking_not_allowed';
  end if;
  if v_rider.status <> 'cancelled' then
    raise exception 'transport_refund_needs_cancel';
  end if;
  -- Only money that arrived can go back.
  if not exists (
    select 1 from public.payment_requests pr where pr.transport_booking_id = v_rider.booking_id and pr.status in ('paid', 'refunded')
  ) then
    raise exception 'transport_refund_nothing_paid';
  end if;
  if v_rider.refund_minor + p_amount_minor > v_rider.amount_minor then
    raise exception 'transport_refund_too_much';
  end if;

  update public.transport_booking_riders
     set refund_minor = refund_minor + p_amount_minor,
         refunded_at = now(), refunded_by = v_actor, refund_note = trim(p_note)
   where id = p_rider_id;

  select email into v_label from public.staff_profiles where id = v_actor;
  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, after)
  values ('staff', v_actor, coalesce(v_label, 'Staff'), 'transport.refund_recorded', 'transport_booking', v_rider.booking_id,
          jsonb_build_object('reference', v_rider.reference, 'rider_id', p_rider_id, 'amount_minor', p_amount_minor,
                             'refund_total_minor', v_rider.refund_minor + p_amount_minor));
end;
$$;

revoke all on function public.transport_record_refund(uuid, bigint, text) from public, anon;
grant execute on function public.transport_record_refund(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Read only, for staff. Nobody writes these rows through the API: the parent
-- through the service role and `create_transport_booking`, staff through the
-- two functions above.
--
-- A child is seen at their own school. A booking is seen by anyone who can
-- see one of its children: a Broadhurst coordinator sees the parent's
-- details on a booking with a Broadhurst child, and only that child. Group
-- staff, with no campus assigned, see everything.
alter table public.transport_bookings enable row level security;
alter table public.transport_booking_riders enable row level security;

drop policy if exists transport_riders_select on public.transport_booking_riders;
create policy transport_riders_select on public.transport_booking_riders
  for select using (
    (select public.has_permission('transport.read'))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists transport_bookings_select on public.transport_bookings;
create policy transport_bookings_select on public.transport_bookings
  for select using (
    (select public.has_permission('transport.read'))
    and exists (
      select 1 from public.transport_booking_riders r
       where r.booking_id = transport_bookings.id
         and (select public.can_access_campus(r.campus_id))
    )
  );

comment on table public.transport_bookings is
  'One household''s school transport for one period, typed in on the public page. Priced per child in transport_booking_riders.';
comment on table public.transport_booking_riders is
  'A child on a transport booking: school, grade, service, weekdays, and a frozen snapshot of the tariff and the amounts it produced.';
comment on column public.transport_booking_riders.provider_amount_minor is
  'What Watermark is owed for this child, incl. VAT: list × (1 − rebate) × (1 + VAT) × days ÷ (5 × divisor), rounded half up once.';

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

-- The rule against the sheet, with no booking needed: the same arithmetic the
-- function writes, on the twelve tariffs, a full week, a term.
do $$
declare
  v_got text;
begin
  select string_agg(format('%s/%s/%s=%s,%s', z.code, t.service, t.household,
           (2 * t.customer_term_minor * 5 + 5) / 10,
           (2 * t.provider_list_term_minor * (10000 - p.rebate_bp) * (10000 + p.vat_bp) * 5 + 500000000::bigint) / 1000000000::bigint),
         ' ' order by z.code, t.service, t.household)
    into v_got
    from public.transport_tariffs t
    join public.transport_price_lists p on p.id = t.price_list_id
    join public.transport_zones z on z.id = t.zone_id;
  if v_got <> 'gaborone/full/different_schools=440000,382493 gaborone/full/same_school=425000,372643 gaborone/full/single=460000,402192 '
             || 'gaborone/one_way/different_schools=330000,287280 gaborone/one_way/same_school=320000,278251 gaborone/one_way/single=350000,301234 '
             || 'north/full/different_schools=485000,425174 north/full/same_school=475000,415325 north/full/single=515000,448157 '
             || 'north/one_way/different_schools=365000,319291 north/one_way/same_school=360000,311494 north/one_way/single=385000,336118' then
    raise exception 'the transport price rule does not reproduce the sheet: %', v_got;
  end if;
end
$$;
