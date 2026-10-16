-- School transport, part four: paying Watermark.
--
-- Hibiscus collects the parent's money and pays Watermark its nett for each
-- child (`transport_booking_riders.provider_amount_minor`). A payout is a
-- transfer finance has already made, recorded here with the children it
-- covered, so that no child is ever paid out twice and the statement of what
-- is still owed is a query rather than a spreadsheet somebody keeps.
--
-- A child cancelled after Watermark was paid for them becomes a credit on a
-- later payout. How much of the line is credited is finance's call, because
-- it depends on how much of the service was used: the amount is entered, up
-- to the line's nett.
--
-- Recorded, never edited. A mistake is put right by the next payout.

create table if not exists public.transport_payouts (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.transport_providers(id) on delete restrict,
  paid_on date not null,
  bank_reference text not null check (char_length(trim(bank_reference)) between 1 and 120),
  note text check (note is null or char_length(note) <= 1000),
  currency text not null default 'BWP' check (currency = 'BWP'),
  -- Charges less credits, worked out by `transport_record_payout`.
  total_minor bigint not null check (total_minor > 0),
  recorded_by uuid not null references public.staff_profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists transport_payouts_provider_idx on public.transport_payouts(provider_id, paid_on desc);

create table if not exists public.transport_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.transport_payouts(id) on delete restrict,
  rider_id uuid not null references public.transport_booking_riders(id) on delete restrict,
  kind text not null check (kind in ('charge', 'credit')),
  amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now(),
  -- Each child is paid for once and credited at most once.
  unique (rider_id, kind)
);

create index if not exists transport_payout_items_payout_idx on public.transport_payout_items(payout_id);

-- Neither table is ever changed or emptied after the fact, by anybody.
create or replace function public.transport_payouts_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'transport_payout_immutable' using
    detail = 'A recorded payout cannot be changed. Put a mistake right on the next payout.';
end;
$$;

revoke all on function public.transport_payouts_immutable() from public, anon, authenticated;

drop trigger if exists transport_payouts_immutable on public.transport_payouts;
create trigger transport_payouts_immutable
  before update or delete on public.transport_payouts
  for each row execute function public.transport_payouts_immutable();

drop trigger if exists transport_payout_items_immutable on public.transport_payout_items;
create trigger transport_payout_items_immutable
  before update or delete on public.transport_payout_items
  for each row execute function public.transport_payouts_immutable();

-- ---------------------------------------------------------------------------
-- Recording one
-- ---------------------------------------------------------------------------

-- p_charge_rider_ids: the children being paid for. Each must be booked (not
--   cancelled) on a paid booking with this provider, visible to the caller,
--   and not paid for before.
-- p_credits: [{ rider_id, amount_minor }] for children paid for earlier and
--   cancelled since. At most the line's nett, once per child.
--
-- The total is computed here, from the lines, and must come to more than
-- nothing: a payout is money that went to Watermark.
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
    select r.id, r.campus_id, r.status, r.provider_amount_minor, b.status as booking_status, b.provider_id
      from public.transport_booking_riders r
      join public.transport_bookings b on b.id = r.booking_id
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
  if (select count(*) from public.transport_booking_riders where id = any (v_charges)) <> cardinality(v_charges) then
    raise exception 'transport_rider_not_found';
  end if;

  -- Credits.
  for v_credit in select * from jsonb_array_elements(v_credits) loop
    v_amount := (v_credit->>'amount_minor')::bigint;
    select r.id, r.campus_id, r.status, r.provider_amount_minor, b.provider_id into v_rider
      from public.transport_booking_riders r
      join public.transport_bookings b on b.id = r.booking_id
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
  select v_payout, r.id, 'charge', r.provider_amount_minor
    from public.transport_booking_riders r
   where r.id = any (v_charges);

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
-- Row-level security
-- ---------------------------------------------------------------------------

-- Finance's, and nobody else's. A payout is group-level, because the transfer
-- is; its lines are read through the children they name, so a bursar scoped
-- to Broadhurst sees what was paid for Broadhurst children.
alter table public.transport_payouts enable row level security;
alter table public.transport_payout_items enable row level security;

drop policy if exists transport_payouts_select on public.transport_payouts;
create policy transport_payouts_select on public.transport_payouts
  for select using ((select public.has_permission('transport.finance')));

drop policy if exists transport_payout_items_select on public.transport_payout_items;
create policy transport_payout_items_select on public.transport_payout_items
  for select using (
    (select public.has_permission('transport.finance'))
    and exists (
      select 1 from public.transport_booking_riders r
       where r.id = transport_payout_items.rider_id
         and (select public.can_access_campus(r.campus_id))
    )
  );

comment on table public.transport_payouts is
  'A transfer to the transport provider, recorded by finance after it was made. Never edited.';
comment on table public.transport_payout_items is
  'Which children a payout paid for (charge) or took back (credit). Each child is charged once and credited at most once.';
