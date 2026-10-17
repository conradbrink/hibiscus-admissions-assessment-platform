-- School transport, part one: what the shuttle costs and when it can be booked.
--
-- Hibiscus is starting a school shuttle run by Watermark Tours. A parent books
-- on a public page (no login, like `/join`), names one or more children, their
-- home area and each child's school, picks the weekdays and the service, and
-- pays online. Behind it the school needs a rider list for Watermark, a
-- financial report and what is owed to Watermark.
--
-- This file is the catalogue: the provider, the price zones, the areas a
-- parent can pick, the price list and its twelve tariffs, the periods a
-- booking is for, and the terms a parent accepts. The bookings, the money and
-- the payouts follow in their own files.
--
-- Prices come from the school's sheet, "Hibiscus_Watermark_Shuttle_Fees.xlsx",
-- per term and including VAT. Two figures per tariff:
--
--   * what the parent pays for a term (`customer_term_minor`), and
--   * Watermark's own price for a term, *excluding* VAT
--     (`provider_list_term_minor`).
--
-- Watermark's nett is derived, never typed: list × (1 − rebate) × (1 + VAT),
-- with the rebate (10%) and VAT (14%) on the price list in basis points. Every
-- nett on the sheet is exactly that over a whole-pula list price — 4368 × 0.9
-- × 1.14 = 4481.568 — and storing the nett itself would mean fractions of a
-- thebe, which the money helpers in the app rightly refuse.
--
-- The rounding rule, whole thebe, half up, once per child line, lives with
-- the bookings in the next file.

-- ---------------------------------------------------------------------------
-- Permissions and the role that carries them
-- ---------------------------------------------------------------------------

-- Four, because four different people do four different things: the office
-- reads the bookings, somebody hands Watermark its list, finance sees the
-- money, and whoever runs the service sets the prices and dates. Recording a
-- payout or a refund also needs `finance.write`, the same as every other
-- write that moves money, so Management can read the report without being
-- able to pay anybody.
insert into public.permissions (code, label, sort_order) values
  ('transport.read',    'View school transport bookings and riders',                    200),
  ('transport.export',  'Download the transport rider list for the provider',           201),
  ('transport.finance', 'View transport earnings and payouts to the provider',          202),
  ('transport.manage',  'Set transport prices, areas, dates and terms; cancel bookings', 203)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

-- Not campus-scoped: the shuttle is one service for the group. A coordinator
-- given campuses under Settings sees those campuses' children only, like
-- anybody else.
insert into public.roles (code, name, description, is_system, campus_scoped)
values ('transport_coordinator', 'Transport coordinator',
        'Runs the school shuttle: bookings, the rider list for the provider, prices, areas and dates. No admissions access.',
        true, false)
on conflict (code) do update set name = excluded.name, description = excluded.description, campus_scoped = excluded.campus_scoped;

with grants(role_code, permission_code) as (
  values
    ('transport_coordinator',   'transport.read'),
    ('transport_coordinator',   'transport.export'),
    ('transport_coordinator',   'transport.manage'),
    ('management',              'transport.read'),
    ('management',              'transport.export'),
    ('management',              'transport.finance'),
    ('finance',                 'transport.read'),
    ('finance',                 'transport.finance'),
    ('chief_financial_officer', 'transport.read'),
    ('chief_financial_officer', 'transport.export'),
    ('chief_financial_officer', 'transport.finance')
)
insert into public.role_permissions (role_id, permission_code)
select r.id, g.permission_code
  from grants g
  join public.roles r on r.code = g.role_code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The provider
-- ---------------------------------------------------------------------------

create table if not exists public.transport_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  name text not null check (char_length(trim(name)) between 1 and 120),
  -- Who the rider list goes to. Staff-facing only.
  contact_name text check (contact_name is null or char_length(contact_name) <= 120),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or char_length(contact_phone) <= 40),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists transport_providers_set_updated_at on public.transport_providers;
create trigger transport_providers_set_updated_at
  before update on public.transport_providers
  for each row execute function public.set_updated_at();

insert into public.transport_providers (code, name) values ('watermark', 'Watermark Tours')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Where a child is collected from
-- ---------------------------------------------------------------------------

-- The price depends on where the child lives, not on the school: the sheet
-- has one block for Phakalane, Gaborone North and Tlokweng and one for
-- Gaborone.
create table if not exists public.transport_zones (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9_]+$'),
  label text not null check (char_length(trim(label)) between 1 and 120),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists transport_zones_set_updated_at on public.transport_zones;
create trigger transport_zones_set_updated_at
  before update on public.transport_zones
  for each row execute function public.set_updated_at();

insert into public.transport_zones (code, label, sort_order) values
  ('north',    'Phakalane, Gaborone North and Tlokweng', 10),
  ('gaborone', 'Gaborone',                               20)
on conflict (code) do nothing;

-- What the parent picks. Seeded with the four names on the sheet and no more:
-- which suburbs Watermark serves, and in which zone, is Watermark's to say,
-- and a guessed list would price somebody wrongly. Staff add the rest under
-- Settings. A parent whose area is not listed is shown who to call.
create table if not exists public.transport_areas (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.transport_zones(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists transport_areas_name_idx on public.transport_areas (lower(trim(name)));

drop trigger if exists transport_areas_set_updated_at on public.transport_areas;
create trigger transport_areas_set_updated_at
  before update on public.transport_areas
  for each row execute function public.set_updated_at();

insert into public.transport_areas (zone_id, name, sort_order)
select z.id, a.name, a.sort_order
  from (values
    ('north',    'Phakalane',       10),
    ('north',    'Gaborone North',  20),
    ('north',    'Tlokweng',        30),
    ('gaborone', 'Gaborone',        40)
  ) as a(zone_code, name, sort_order)
  join public.transport_zones z on z.code = a.zone_code
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The price list
-- ---------------------------------------------------------------------------

-- Pula only. The shuttle runs in Gaborone; a Potchefstroom service would be a
-- different provider and a different currency, and the gateway cannot take
-- rand yet (`lib/payments/online.ts`).
create table if not exists public.transport_price_lists (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.transport_providers(id) on delete restrict,
  label text not null check (char_length(trim(label)) between 1 and 120),
  currency text not null default 'BWP' check (currency = 'BWP'),
  -- Hibiscus's share of Watermark's list price, and VAT, in basis points:
  -- 1000 is 10%, 1400 is 14%.
  rebate_bp int not null check (rebate_bp between 0 and 9999),
  vat_bp int not null check (vat_bp between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists transport_price_lists_set_updated_at on public.transport_price_lists;
create trigger transport_price_lists_set_updated_at
  before update on public.transport_price_lists
  for each row execute function public.set_updated_at();

-- One row per zone × service × household.
--
-- `service` is what the sheet prices: the full shuttle (collected and brought
-- home) or one way. A parent picks morning only or afternoon only, and either
-- is the one-way price.
--
-- `household` is decided per child, counting the children on one booking:
-- one child is `single`; a child who shares a school with another child on
-- the booking is `same_school`; a child who is the only one at their school
-- is `different_schools`. Two at Broadhurst and one at Block 7 is two
-- same-school children and one different-schools child.
create table if not exists public.transport_tariffs (
  id uuid primary key default gen_random_uuid(),
  price_list_id uuid not null references public.transport_price_lists(id) on delete cascade,
  zone_id uuid not null references public.transport_zones(id) on delete restrict,
  service text not null check (service in ('full', 'one_way')),
  household text not null check (household in ('single', 'different_schools', 'same_school')),
  -- What the parent pays for a whole term, five days a week, including VAT.
  customer_term_minor bigint not null check (customer_term_minor > 0),
  -- Watermark's own price for the same, excluding VAT, before the rebate.
  provider_list_term_minor bigint not null check (provider_list_term_minor > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (price_list_id, zone_id, service, household)
);

drop trigger if exists transport_tariffs_set_updated_at on public.transport_tariffs;
create trigger transport_tariffs_set_updated_at
  before update on public.transport_tariffs
  for each row execute function public.set_updated_at();

-- Watermark's nett can never be more than the parent pays. A tariff where it
-- was would pay Watermark money Hibiscus never collected, and the likeliest
-- way to get there is typing Watermark's price including VAT into the column
-- that excludes it. Checked exactly, in whole numbers, with no rounding: nett
-- ≤ customer is list·(10000−rebate)·(10000+vat) ≤ customer·10⁸.
--
-- One trigger function on both tables, rather than a helper both call: a
-- trigger runs as whoever changed the row, and a helper would need an
-- execute grant to every member of staff who can edit a price.
create or replace function public.transport_check_margin()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_list uuid;
begin
  -- Two statements, not one CASE: each names a field only the other table's
  -- row has, and a single expression would be planned against both.
  if tg_table_name = 'transport_price_lists' then
    v_list := new.id;
  else
    v_list := new.price_list_id;
  end if;
  if exists (
    select 1
      from public.transport_tariffs t
      join public.transport_price_lists p on p.id = t.price_list_id
     where t.price_list_id = v_list
       and t.provider_list_term_minor::numeric * (10000 - p.rebate_bp) * (10000 + p.vat_bp)
           > t.customer_term_minor::numeric * 100000000
  ) then
    raise exception 'transport_nett_exceeds_price' using
      detail = 'Watermark''s price after the rebate and VAT would be more than the parent pays. Check that Watermark''s price was entered without VAT.';
  end if;
  return null;
end;
$$;

revoke all on function public.transport_check_margin() from public, anon, authenticated;

drop trigger if exists transport_tariffs_margin on public.transport_tariffs;
create constraint trigger transport_tariffs_margin
  after insert or update on public.transport_tariffs
  deferrable initially immediate
  for each row execute function public.transport_check_margin();

drop trigger if exists transport_price_lists_margin on public.transport_price_lists;
create constraint trigger transport_price_lists_margin
  after update of rebate_bp, vat_bp on public.transport_price_lists
  deferrable initially immediate
  for each row execute function public.transport_check_margin();

-- The sheet, row for row. Watermark's list price is the sheet's nett ÷ 1.026
-- (0.9 × 1.14), which is a whole pula on every row.
do $$
declare
  v_provider uuid;
  v_list uuid;
begin
  select id into v_provider from public.transport_providers where code = 'watermark';
  if exists (select 1 from public.transport_price_lists where provider_id = v_provider) then
    return;
  end if;
  insert into public.transport_price_lists (provider_id, label, currency, rebate_bp, vat_bp)
  values (v_provider, 'Watermark Tours 2026–2027', 'BWP', 1000, 1400)
  returning id into v_list;

  insert into public.transport_tariffs (price_list_id, zone_id, service, household, customer_term_minor, provider_list_term_minor)
  select v_list, z.id, t.service, t.household, t.customer * 100, t.list * 100
    from (values
      ('north',    'full',    'single',             5150, 4368),
      ('north',    'full',    'different_schools',  4850, 4144),
      ('north',    'full',    'same_school',        4750, 4048),
      ('north',    'one_way', 'single',             3850, 3276),
      ('north',    'one_way', 'different_schools',  3650, 3112),
      ('north',    'one_way', 'same_school',        3600, 3036),
      ('gaborone', 'full',    'single',             4600, 3920),
      ('gaborone', 'full',    'different_schools',  4400, 3728),
      ('gaborone', 'full',    'same_school',        4250, 3632),
      ('gaborone', 'one_way', 'single',             3500, 2936),
      ('gaborone', 'one_way', 'different_schools',  3300, 2800),
      ('gaborone', 'one_way', 'same_school',        3200, 2712)
    ) as t(zone_code, service, household, customer, list)
    join public.transport_zones z on z.code = t.zone_code;
end
$$;

-- ---------------------------------------------------------------------------
-- What a booking is for: a term, or one month of it
-- ---------------------------------------------------------------------------

-- A parent pays for a term or for a month. A month is its own period with its
-- own dates, its own booking window and its own payment: the gateway cannot
-- charge a card again on its own, so "monthly" is a booking each month, not a
-- subscription.
--
-- A month is priced as the term's price ÷ `billing_months` (3, from the
-- sheet's "months per term"), and takes its price list from its term so the
-- two can never be priced from different lists.
--
-- Nothing is seeded: the dates are the school's, and booking stays shut until
-- somebody publishes a period.
create table if not exists public.transport_periods (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('term', 'month')),
  term_period_id uuid references public.transport_periods(id) on delete cascade,
  month_index smallint,
  label text not null check (char_length(trim(label)) between 1 and 80),
  starts_on date not null,
  ends_on date not null,
  booking_opens_on date not null,
  booking_closes_on date not null,
  billing_months smallint not null default 3 check (billing_months between 1 and 12),
  price_list_id uuid not null references public.transport_price_lists(id) on delete restrict,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (booking_closes_on >= booking_opens_on),
  check (booking_closes_on <= ends_on),
  check (
    (kind = 'term' and term_period_id is null and month_index is null)
    or (kind = 'month' and term_period_id is not null and month_index is not null)
  ),
  unique (term_period_id, month_index)
);

create index if not exists transport_periods_term_idx on public.transport_periods(term_period_id) where term_period_id is not null;

drop trigger if exists transport_periods_set_updated_at on public.transport_periods;
create trigger transport_periods_set_updated_at
  before update on public.transport_periods
  for each row execute function public.set_updated_at();

-- A month belongs to a term, sits inside it, and is priced from its list. The
-- price list and the number of months are copied from the term whatever the
-- caller sent, the same way `optional_items` takes its currency from its
-- campus.
create or replace function public.transport_periods_follow_term()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_term record;
begin
  if new.kind = 'month' then
    select kind, starts_on, ends_on, price_list_id, billing_months
      into v_term
      from public.transport_periods
     where id = new.term_period_id;
    if not found or v_term.kind <> 'term' then
      raise exception 'transport_month_needs_a_term';
    end if;
    new.price_list_id := v_term.price_list_id;
    new.billing_months := v_term.billing_months;
    if new.month_index < 1 or new.month_index > v_term.billing_months then
      raise exception 'transport_month_index_out_of_range';
    end if;
    if new.starts_on < v_term.starts_on or new.ends_on > v_term.ends_on then
      raise exception 'transport_month_outside_term';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.transport_periods_follow_term() from public, anon, authenticated;

drop trigger if exists transport_periods_follow_term on public.transport_periods;
create trigger transport_periods_follow_term
  before insert or update on public.transport_periods
  for each row execute function public.transport_periods_follow_term();

-- And a term's own list or month count, changed later, reaches its months.
create or replace function public.transport_periods_cascade_term()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'term'
     and (new.price_list_id is distinct from old.price_list_id or new.billing_months is distinct from old.billing_months) then
    update public.transport_periods
       set price_list_id = new.price_list_id, billing_months = new.billing_months
     where term_period_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.transport_periods_cascade_term() from public, anon, authenticated;

drop trigger if exists transport_periods_cascade_term on public.transport_periods;
create trigger transport_periods_cascade_term
  after update of price_list_id, billing_months on public.transport_periods
  for each row execute function public.transport_periods_cascade_term();

-- ---------------------------------------------------------------------------
-- The terms a parent accepts
-- ---------------------------------------------------------------------------

-- Plain text, versioned, and frozen once published: a booking records the
-- version and the hash of what the parent agreed to, so the words behind it
-- can never change underneath it. Not `agreement_templates`, which
-- registration lists in full for every child joining the school.
--
-- Nothing is seeded. The wording is the school's and Watermark's to write,
-- and booking stays shut until a version is published.
create table if not exists public.transport_terms (
  id uuid primary key default gen_random_uuid(),
  version int not null unique check (version > 0),
  body_text text not null check (char_length(trim(body_text)) between 1 and 20000),
  -- sha256 of the body, set by trigger: what a booking stores beside the version.
  body_hash text not null default '',
  published_at timestamptz,
  published_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.transport_terms_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and old.published_at is not null then
    if new.body_text is distinct from old.body_text
       or new.version is distinct from old.version
       or new.published_at is distinct from old.published_at then
      raise exception 'transport_terms_published' using
        detail = 'Published terms are what parents agreed to. Write a new version instead.';
    end if;
  end if;
  new.body_hash := encode(sha256(convert_to(new.body_text, 'UTF8')), 'hex');
  return new;
end;
$$;

revoke all on function public.transport_terms_guard() from public, anon, authenticated;

drop trigger if exists transport_terms_guard on public.transport_terms;
create trigger transport_terms_guard
  before insert or update on public.transport_terms
  for each row execute function public.transport_terms_guard();

-- The version a parent is shown and must accept: the newest published one.
create or replace function public.current_transport_terms_id()
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select id from public.transport_terms
   where published_at is not null
   order by version desc
   limit 1
$$;

revoke all on function public.current_transport_terms_id() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

-- Booking ships shut, like every automation here: a published period and
-- published terms are not enough on their own, somebody also has to say go.
insert into public.settings (key, value, description) values
  ('transport_booking_enabled', 'false',
   'Parents can book and pay for school transport on the public page. Needs a published period and published terms as well.'),
  ('transport_session_minutes', '120',
   'How long a parent''s transport booking page stays signed in, in minutes.'),
  ('transport_unpaid_hours', '72',
   'An unpaid transport booking expires after this many hours, and a parent books again.'),
  ('transport_retention_days', '730',
   'Days after a transport period ends before a booking''s names, contacts and address are removed. The amounts are kept.'),
  ('transport_unpaid_retention_days', '30',
   'Days after an unpaid transport booking expired before its names, contacts and address are removed.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

-- Reference data: any member of staff can read it (the booking pages need the
-- area names), and only `transport.manage` can change it. Parents read it
-- through the service role, like every other parent page.
alter table public.transport_providers enable row level security;
alter table public.transport_zones enable row level security;
alter table public.transport_areas enable row level security;
alter table public.transport_price_lists enable row level security;
alter table public.transport_tariffs enable row level security;
alter table public.transport_periods enable row level security;
alter table public.transport_terms enable row level security;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'transport_providers', 'transport_zones', 'transport_areas',
    'transport_price_lists', 'transport_tariffs', 'transport_periods', 'transport_terms'
  ] loop
    execute format('drop policy if exists %I on public.%I', v_table || '_select', v_table);
    execute format(
      'create policy %I on public.%I for select using ((select public.current_staff_id()) is not null)',
      v_table || '_select', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_write', v_table);
    execute format(
      'create policy %I on public.%I for all using ((select public.has_permission(''transport.manage''))) with check ((select public.has_permission(''transport.manage'')))',
      v_table || '_write', v_table);
  end loop;
end
$$;

-- Published terms are not deleted either: a booking points at them.
drop policy if exists transport_terms_write on public.transport_terms;
drop policy if exists transport_terms_insert on public.transport_terms;
create policy transport_terms_insert on public.transport_terms
  for insert with check ((select public.has_permission('transport.manage')));
drop policy if exists transport_terms_update on public.transport_terms;
create policy transport_terms_update on public.transport_terms
  for update using ((select public.has_permission('transport.manage')));
drop policy if exists transport_terms_delete on public.transport_terms;
create policy transport_terms_delete on public.transport_terms
  for delete using ((select public.has_permission('transport.manage')) and published_at is null);

comment on table public.transport_tariffs is
  'School transport prices per term: what the parent pays (incl. VAT) and Watermark''s own price (excl. VAT). Watermark''s nett is list × (1 − rebate) × (1 + VAT), from the price list.';
comment on table public.transport_periods is
  'A transport term, or one month of it. A booking is for one period; a month is priced as the term ÷ billing_months.';
comment on table public.transport_terms is
  'The transport terms a parent accepts, versioned and frozen once published. A booking stores the version and the hash.';

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
declare
  v_count int;
  v_nett numeric;
begin
  select count(*) into v_count
    from public.transport_tariffs t
    join public.transport_price_lists p on p.id = t.price_list_id
    join public.transport_providers pr on pr.id = p.provider_id
   where pr.code = 'watermark';
  if v_count <> 12 then
    raise exception 'expected 12 Watermark tariffs, found %', v_count;
  end if;

  -- The first row of the sheet, to the thebe: P 4,481.568.
  select t.provider_list_term_minor::numeric * (10000 - p.rebate_bp) * (10000 + p.vat_bp) / 100000000
    into v_nett
    from public.transport_tariffs t
    join public.transport_price_lists p on p.id = t.price_list_id
    join public.transport_zones z on z.id = t.zone_id
   where z.code = 'north' and t.service = 'full' and t.household = 'single';
  if v_nett <> 448156.8 then
    raise exception 'the first tariff does not reproduce the sheet: % thebe', v_nett;
  end if;

  if (select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
       where r.code = 'transport_coordinator') <> 3 then
    raise exception 'the transport coordinator role is missing a permission';
  end if;

  -- Booking cannot open by accident on the day this ships.
  if (select value from public.settings where key = 'transport_booking_enabled') <> 'false'::jsonb then
    raise exception 'transport booking must ship switched off';
  end if;
end
$$;
