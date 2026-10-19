-- School transport: the provider's prices are finance's alone.
--
-- Watermark's list price for each tariff, and what it is owed for each child,
-- sat in columns of `transport_tariffs` (readable by every member of staff)
-- and `transport_booking_riders` (readable with `transport.read`). The
-- screens showed them only to `transport.finance`, but a member of staff
-- could have read them through the API with their own login. The school
-- decided on 19 October 2026 that only finance roles may read them at all.
--
-- Row-level security works on rows, not columns, and every member of staff
-- signs in as the same database role, so the figures move to two tables of
-- their own whose read policy asks for `transport.finance`:
--
--   transport_tariff_provider_prices  the provider's list price per tariff
--   transport_rider_provider_shares   the provider's list price and amount
--                                     for each child's line, frozen
--
-- The functions that price a booking and record a payout run as their owner
-- and read them there; nothing outside finance is handed them. The rebate and
-- VAT stay where they were: neither gives a price away on its own.
--
-- A new migration rather than an edit to part 1, so a database that already
-- has part 1 gets this too.

-- ---------------------------------------------------------------------------
-- The two tables
-- ---------------------------------------------------------------------------

create table if not exists public.transport_tariff_provider_prices (
  tariff_id uuid primary key references public.transport_tariffs(id) on delete cascade,
  -- The provider's own price for a whole term, five days a week, excluding
  -- VAT, before the rebate. Set by migration, as the tariffs are.
  provider_list_term_minor bigint not null check (provider_list_term_minor > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists transport_tariff_provider_prices_set_updated_at on public.transport_tariff_provider_prices;
create trigger transport_tariff_provider_prices_set_updated_at
  before update on public.transport_tariff_provider_prices
  for each row execute function public.set_updated_at();

insert into public.transport_tariff_provider_prices (tariff_id, provider_list_term_minor)
select id, provider_list_term_minor from public.transport_tariffs
on conflict (tariff_id) do nothing;

create table if not exists public.transport_rider_provider_shares (
  rider_id uuid primary key references public.transport_booking_riders(id) on delete cascade,
  provider_list_term_minor bigint not null check (provider_list_term_minor > 0),
  -- What the provider is owed for this child, incl. VAT:
  -- list × (1 − rebate) × (1 + VAT) × days ÷ (5 × divisor), rounded half up once.
  provider_amount_minor bigint not null check (provider_amount_minor > 0),
  created_at timestamptz not null default now()
);

insert into public.transport_rider_provider_shares (rider_id, provider_list_term_minor, provider_amount_minor)
select id, provider_list_term_minor, provider_amount_minor from public.transport_booking_riders
on conflict (rider_id) do nothing;

-- The share is held to the rule against the child's own frozen snapshot, as
-- the rider row's check constraints held it before, and never changes.
create or replace function public.transport_rider_share_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_rider record;
begin
  if tg_op = 'UPDATE' then
    raise exception 'transport_rider_frozen' using
      detail = 'What the provider is owed for a child is fixed when the booking is made.';
  end if;
  select amount_minor, rebate_bp, vat_bp, days_count, period_divisor into v_rider
    from public.transport_booking_riders where id = new.rider_id;
  if not found then
    raise exception 'transport_rider_not_found';
  end if;
  if new.provider_amount_minor > v_rider.amount_minor
     or new.provider_amount_minor <>
        (2 * new.provider_list_term_minor * (10000 - v_rider.rebate_bp) * (10000 + v_rider.vat_bp) * v_rider.days_count
           + 500000000::bigint * v_rider.period_divisor) / (1000000000::bigint * v_rider.period_divisor) then
    raise exception 'transport_provider_share_mismatch' using
      detail = 'The provider''s amount for a child must follow from its list price and the child''s own line.';
  end if;
  return new;
end;
$$;

revoke all on function public.transport_rider_share_guard() from public, anon, authenticated;

drop trigger if exists transport_rider_share_guard on public.transport_rider_provider_shares;
create trigger transport_rider_share_guard
  before insert or update on public.transport_rider_provider_shares
  for each row execute function public.transport_rider_share_guard();

-- ---------------------------------------------------------------------------
-- Who reads them
-- ---------------------------------------------------------------------------

-- Finance only. No write policy: the prices are set by migration, and a
-- child's share only by `create_transport_booking`.
alter table public.transport_tariff_provider_prices enable row level security;
alter table public.transport_rider_provider_shares enable row level security;

drop policy if exists transport_tariff_provider_prices_select on public.transport_tariff_provider_prices;
create policy transport_tariff_provider_prices_select on public.transport_tariff_provider_prices
  for select using ((select public.has_permission('transport.finance')));

-- A share is read through the child it belongs to, as a payout line is, so a
-- bursar scoped to Broadhurst reads Broadhurst children's.
drop policy if exists transport_rider_provider_shares_select on public.transport_rider_provider_shares;
create policy transport_rider_provider_shares_select on public.transport_rider_provider_shares
  for select using (
    (select public.has_permission('transport.finance'))
    and exists (
      select 1 from public.transport_booking_riders r
       where r.id = transport_rider_provider_shares.rider_id
         and (select public.can_access_campus(r.campus_id))
    )
  );

-- ---------------------------------------------------------------------------
-- The margin check reads the price where it now lives
-- ---------------------------------------------------------------------------

-- `security definer` now: a coordinator who edits a parent's price cannot read
-- the provider's, and a check run as them would find nothing to compare and
-- pass. It also fires when a provider price itself is set.
create or replace function public.transport_check_margin()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_list uuid;
begin
  -- One statement per table: each names a field only its own row has.
  if tg_table_name = 'transport_price_lists' then
    v_list := new.id;
  elsif tg_table_name = 'transport_tariff_provider_prices' then
    select price_list_id into v_list from public.transport_tariffs where id = new.tariff_id;
  else
    v_list := new.price_list_id;
  end if;
  if exists (
    select 1
      from public.transport_tariffs t
      join public.transport_tariff_provider_prices pp on pp.tariff_id = t.id
      join public.transport_price_lists p on p.id = t.price_list_id
     where t.price_list_id = v_list
       and pp.provider_list_term_minor::numeric * (10000 - p.rebate_bp) * (10000 + p.vat_bp)
           > t.customer_term_minor::numeric * 100000000
  ) then
    raise exception 'transport_nett_exceeds_price' using
      detail = 'Watermark''s price after the rebate and VAT would be more than the parent pays. Check that Watermark''s price was entered without VAT.';
  end if;
  return null;
end;
$$;

revoke all on function public.transport_check_margin() from public, anon, authenticated;

drop trigger if exists transport_tariff_provider_prices_margin on public.transport_tariff_provider_prices;
create constraint trigger transport_tariff_provider_prices_margin
  after insert or update on public.transport_tariff_provider_prices
  deferrable initially immediate
  for each row execute function public.transport_check_margin();

-- ---------------------------------------------------------------------------
-- A child's line, frozen without the moved columns
-- ---------------------------------------------------------------------------

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
     or new.rebate_bp is distinct from old.rebate_bp
     or new.vat_bp is distinct from old.vat_bp
     or new.period_divisor is distinct from old.period_divisor
     or new.amount_minor is distinct from old.amount_minor then
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

-- ---------------------------------------------------------------------------
-- Pricing a booking, and paying the provider, from the new tables
-- ---------------------------------------------------------------------------

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
  v_rider_id uuid;
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

    -- The provider's price is finance's alone (its own table, its own
    -- policy); this function runs as its owner and reads it to price the line.
    select t.*, pp.provider_list_term_minor into v_tariff
      from public.transport_tariffs t
      join public.transport_tariff_provider_prices pp on pp.tariff_id = t.id
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
      household, tariff_id, customer_term_minor, rebate_bp, vat_bp, period_divisor,
      amount_minor, notes
    ) values (
      v_booking_id, v_position, trim(v_rider->>'first_name'), trim(v_rider->>'last_name'),
      (v_rider->>'grade_id')::uuid, v_campus, v_service,
      coalesce((v_rider->>'mon')::boolean, false), coalesce((v_rider->>'tue')::boolean, false),
      coalesce((v_rider->>'wed')::boolean, false), coalesce((v_rider->>'thu')::boolean, false),
      coalesce((v_rider->>'fri')::boolean, false),
      v_household, v_tariff.id, v_tariff.customer_term_minor,
      v_list.rebate_bp, v_list.vat_bp, v_divisor,
      (2 * v_tariff.customer_term_minor * v_days + 5 * v_divisor) / (10 * v_divisor),
      nullif(trim(v_rider->>'notes'), '')
    )
    returning id into v_rider_id;

    insert into public.transport_rider_provider_shares (rider_id, provider_list_term_minor, provider_amount_minor)
    values (
      v_rider_id, v_tariff.provider_list_term_minor,
      (2 * v_tariff.provider_list_term_minor * (10000 - v_list.rebate_bp) * (10000 + v_list.vat_bp) * v_days
         + 500000000::bigint * v_divisor) / (1000000000::bigint * v_divisor)
    );
  end loop;

  return v_booking_id;
end;
$$;

revoke all on function public.create_transport_booking(jsonb, jsonb) from public, anon, authenticated;

create or replace function public.transport_record_payout(
  p_provider_id uuid,
  p_paid_on date,
  p_bank_reference text,
  p_note text,
  p_charge_rider_ids uuid[],
  p_credits jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
  v_payout uuid;
  v_charges uuid[] := coalesce(p_charge_rider_ids, '{}');
  v_credits jsonb := coalesce(p_credits, '[]'::jsonb);
  v_charge_total bigint := 0;
  v_credit_total bigint := 0;
  v_credit jsonb;
  v_rider record;
  v_amount bigint;
begin
  if v_actor is null or not public.has_permission('transport.finance') or not public.has_permission('finance.write') then
    raise exception 'permission_denied';
  end if;
  if coalesce(trim(p_bank_reference), '') = '' then
    raise exception 'transport_payout_reference_required';
  end if;
  if p_paid_on is null or p_paid_on > (now() at time zone 'Africa/Gaborone')::date then
    raise exception 'transport_payout_date';
  end if;
  if jsonb_typeof(v_credits) <> 'array' then
    raise exception 'transport_payout_credits_invalid';
  end if;
  if cardinality(v_charges) <> (select count(distinct x) from unnest(v_charges) x) then
    raise exception 'transport_payout_duplicate_line';
  end if;
  if jsonb_array_length(v_credits) <> (select count(distinct (c->>'rider_id')) from jsonb_array_elements(v_credits) c) then
    raise exception 'transport_payout_duplicate_line';
  end if;

  -- Charges.
  for v_rider in
    select r.id, r.campus_id, r.status, s.provider_amount_minor, b.status as booking_status, b.provider_id
      from public.transport_booking_riders r
      join public.transport_bookings b on b.id = r.booking_id
      join public.transport_rider_provider_shares s on s.rider_id = r.id
     where r.id = any (v_charges)
     for update of r
  loop
    if not public.can_access_campus(v_rider.campus_id) then
      raise exception 'transport_booking_not_allowed';
    end if;
    if v_rider.provider_id <> p_provider_id then
      raise exception 'transport_payout_wrong_provider';
    end if;
    if v_rider.booking_status <> 'paid' or v_rider.status <> 'booked' then
      raise exception 'transport_payout_line_not_payable';
    end if;
    if exists (select 1 from public.transport_payout_items i where i.rider_id = v_rider.id and i.kind = 'charge') then
      raise exception 'transport_payout_already_paid';
    end if;
    v_charge_total := v_charge_total + v_rider.provider_amount_minor;
  end loop;
  if (select count(*) from public.transport_booking_riders r
        join public.transport_rider_provider_shares s on s.rider_id = r.id
       where r.id = any (v_charges)) <> cardinality(v_charges) then
    raise exception 'transport_rider_not_found';
  end if;

  -- Credits.
  for v_credit in select * from jsonb_array_elements(v_credits) loop
    v_amount := (v_credit->>'amount_minor')::bigint;
    select r.id, r.campus_id, r.status, s.provider_amount_minor, b.provider_id into v_rider
      from public.transport_booking_riders r
      join public.transport_bookings b on b.id = r.booking_id
      join public.transport_rider_provider_shares s on s.rider_id = r.id
     where r.id = (v_credit->>'rider_id')::uuid
     for update of r;
    if not found then
      raise exception 'transport_rider_not_found';
    end if;
    if not public.can_access_campus(v_rider.campus_id) then
      raise exception 'transport_booking_not_allowed';
    end if;
    if v_rider.provider_id <> p_provider_id then
      raise exception 'transport_payout_wrong_provider';
    end if;
    if v_rider.status <> 'cancelled'
       or not exists (select 1 from public.transport_payout_items i where i.rider_id = v_rider.id and i.kind = 'charge') then
      raise exception 'transport_payout_credit_not_due';
    end if;
    if exists (select 1 from public.transport_payout_items i where i.rider_id = v_rider.id and i.kind = 'credit') then
      raise exception 'transport_payout_already_credited';
    end if;
    if v_amount is null or v_amount <= 0 or v_amount > v_rider.provider_amount_minor then
      raise exception 'transport_payout_credit_amount';
    end if;
    v_credit_total := v_credit_total + v_amount;
  end loop;

  if v_charge_total - v_credit_total <= 0 then
    raise exception 'transport_payout_nothing_owed';
  end if;

  insert into public.transport_payouts (provider_id, paid_on, bank_reference, note, total_minor, recorded_by)
  values (p_provider_id, p_paid_on, trim(p_bank_reference), nullif(trim(p_note), ''), v_charge_total - v_credit_total, v_actor)
  returning id into v_payout;

  insert into public.transport_payout_items (payout_id, rider_id, kind, amount_minor)
  select v_payout, s.rider_id, 'charge', s.provider_amount_minor
    from public.transport_rider_provider_shares s
   where s.rider_id = any (v_charges);

  insert into public.transport_payout_items (payout_id, rider_id, kind, amount_minor)
  select v_payout, (c->>'rider_id')::uuid, 'credit', (c->>'amount_minor')::bigint
    from jsonb_array_elements(v_credits) c;

  select email into v_label from public.staff_profiles where id = v_actor;
  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, after)
  values ('staff', v_actor, coalesce(v_label, 'Staff'), 'transport.payout_recorded', 'transport_payout', v_payout,
          jsonb_build_object('provider_id', p_provider_id, 'paid_on', p_paid_on,
                             'charges', cardinality(v_charges), 'charge_minor', v_charge_total,
                             'credits', jsonb_array_length(v_credits), 'credit_minor', v_credit_total,
                             'total_minor', v_charge_total - v_credit_total));
  return v_payout;
end;
$$;

revoke all on function public.transport_record_payout(uuid, date, text, text, uuid[], jsonb) from public, anon;
grant execute on function public.transport_record_payout(uuid, date, text, text, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- The old columns go
-- ---------------------------------------------------------------------------

-- Every row was copied above. Dropping a column drops the check constraints
-- that named it (the rounding rule and "no more than the parent pays", now
-- the share guard's).
do $$
begin
  if (select count(*) from public.transport_tariffs) <> (select count(*) from public.transport_tariff_provider_prices)
     or (select count(*) from public.transport_booking_riders) <> (select count(*) from public.transport_rider_provider_shares) then
    raise exception 'the provider prices were not all copied';
  end if;
end
$$;

alter table public.transport_booking_riders drop column if exists provider_amount_minor;
alter table public.transport_booking_riders drop column if exists provider_list_term_minor;
alter table public.transport_tariffs drop column if exists provider_list_term_minor;

comment on table public.transport_tariff_provider_prices is
  'The provider''s own price per tariff, excl. VAT, before the rebate. Readable only with transport.finance.';
comment on table public.transport_rider_provider_shares is
  'What the provider is owed for each child''s line, frozen when booked. Readable only with transport.finance, at the child''s campus.';

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
declare
  v_got text;
begin
  -- The sheet still comes out of the rule, from the new table.
  select string_agg(format('%s/%s/%s=%s', z.code, t.service, t.household,
           (2 * pp.provider_list_term_minor * (10000 - p.rebate_bp) * (10000 + p.vat_bp) * 5 + 500000000::bigint) / 1000000000::bigint),
         ' ' order by z.code, t.service, t.household)
    into v_got
    from public.transport_tariffs t
    join public.transport_tariff_provider_prices pp on pp.tariff_id = t.id
    join public.transport_price_lists p on p.id = t.price_list_id
    join public.transport_zones z on z.id = t.zone_id;
  if v_got <> 'gaborone/full/different_schools=382493 gaborone/full/same_school=372643 gaborone/full/single=402192 '
             || 'gaborone/one_way/different_schools=287280 gaborone/one_way/same_school=278251 gaborone/one_way/single=301234 '
             || 'north/full/different_schools=425174 north/full/same_school=415325 north/full/single=448157 '
             || 'north/one_way/different_schools=319291 north/one_way/same_school=311494 north/one_way/single=336118' then
    raise exception 'the provider prices no longer reproduce the sheet: %', v_got;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public'
       and policyname in ('transport_tariff_provider_prices_select', 'transport_rider_provider_shares_select')) <> 2 then
    raise exception 'the provider price policies are missing';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name in ('transport_tariffs', 'transport_booking_riders')
              and column_name in ('provider_list_term_minor', 'provider_amount_minor')) then
    raise exception 'a provider price is still in a table every member of staff can read';
  end if;
end
$$;
