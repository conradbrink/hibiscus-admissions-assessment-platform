-- Hibiscus Stores: the storeroom register.
--
-- A third product on the same staff session, the same `permissions` table and
-- the same sign-in, beside Admissions and the CRM. It answers five questions
-- for the Purchasing Officer: what the school owns, how much of it is on the
-- shelf, who has what, when it is due back, and what has been issued,
-- returned, bought or permanently allocated.
--
-- This migration is the foundation: who may open Stores, and the things a
-- stock movement is about (a department, a category, a storage place, an
-- employee, an item). The transactions are in the next file and the functions
-- that are their only writers in the one after.
--
-- Three decisions are worth reading before the DDL:
--
--   1. An employee is not a member of staff in the platform's sense. They
--      have no account, no login and no row in `auth.users`; they collect
--      equipment and sign on the storekeeper's phone. `stores_employees` is a
--      directory, nothing more, and nothing in Stores ever sends them a
--      message.
--
--   2. An item carries its own balances, in four buckets that always add up
--      to what the school owns: on the shelf (`qty_available`), out on loan
--      (`qty_checked_out`), permanently assigned (`qty_assigned`) and held
--      back as damaged or awaiting repair (`qty_unavailable`). Staff have no
--      grant on any of the four. They move only through the functions in
--      `stores_functions`, each of which writes the matching line in
--      `stores_movements` in the same transaction, so a balance and its
--      history cannot drift apart. `stores_reconciliation()` proves it.
--
--   3. Nothing here is ever deleted. An item, an employee, a department, a
--      category or a storage place with history behind it is switched off
--      (`is_active`), and the foreign keys from the transactions are
--      `on delete restrict` so that a delete from anywhere else fails loudly.

-- ---------------------------------------------------------------------------
-- Permissions and roles
-- ---------------------------------------------------------------------------

insert into public.permissions (code, label, sort_order) values
  ('stores.read',  'View Hibiscus Stores: inventory, equipment on loan, stock movements and reports', 300),
  ('stores.write', 'Record stock: receive, check out, check in, issue consumables and assign assets',  302),
  ('stores.admin', 'Manage Stores settings, adjust stock and reverse a transaction, with a reason',   304)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

-- Two roles, as the school asked. Neither is campus-scoped: there is one
-- central storeroom, and the storekeeper serves every campus from it.
insert into public.roles (code, name, description, is_system, campus_scoped) values
  ('storekeeper',  'Purchasing Officer / Storekeeper', 'Runs the storeroom: receives stock, checks equipment out and in, issues consumables and assigns assets.', true, false),
  ('stores_admin', 'Stores administrator',             'Everything in Hibiscus Stores, including its settings, stock adjustments and documented reversals.',      true, false)
on conflict (code) do update set name = excluded.name, description = excluded.description, campus_scoped = excluded.campus_scoped;

-- The super administrator holds `admin`, which satisfies every check, so it
-- needs no row here.
with grants(role_code, permission_code) as (
  values
    ('storekeeper',  'stores.read'),
    ('storekeeper',  'stores.write'),

    ('stores_admin', 'stores.read'),
    ('stores_admin', 'stores.write'),
    ('stores_admin', 'stores.admin')
)
insert into public.role_permissions (role_id, permission_code)
select r.id, g.permission_code
  from grants g
  join public.roles r on r.code = g.role_code
    on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Who last touched a row
-- ---------------------------------------------------------------------------

-- `set_updated_at()` with the person added. The settings tables are edited
-- straight through the API under row-level security, so the row itself is the
-- only place that can say who changed it.
create or replace function public.stores_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  -- Null under the service role, where the caller's id is not known; the
  -- previous name is kept rather than blanked.
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

revoke all on function public.stores_touch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Departments, categories, storage places
-- ---------------------------------------------------------------------------

create table if not exists public.stores_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_profiles(id) on delete set null
);

comment on table public.stores_departments is
  'The departments stock is issued to and assets are assigned to. Switched off, never deleted.';

create unique index if not exists stores_departments_name_key on public.stores_departments (lower(btrim(name)));

create table if not exists public.stores_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_profiles(id) on delete set null
);

create unique index if not exists stores_categories_name_key on public.stores_categories (lower(btrim(name)));

-- One central storeroom today. The table is here so that a second place is a
-- row and not a redesign: an item names where it is kept, and a transfer
-- between places is a movement type the ledger already accepts.
create table if not exists public.stores_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_profiles(id) on delete set null
);

comment on table public.stores_locations is
  'Where stock is kept. One row for the first release; an item names its place so more can be added without a redesign.';

create unique index if not exists stores_locations_name_key on public.stores_locations (lower(btrim(name)));

drop trigger if exists stores_departments_touch on public.stores_departments;
create trigger stores_departments_touch before update on public.stores_departments
  for each row execute function public.stores_touch();
drop trigger if exists stores_categories_touch on public.stores_categories;
create trigger stores_categories_touch before update on public.stores_categories
  for each row execute function public.stores_touch();
drop trigger if exists stores_locations_touch on public.stores_locations;
create trigger stores_locations_touch before update on public.stores_locations
  for each row execute function public.stores_touch();

-- ---------------------------------------------------------------------------
-- Employees: the people who collect stock
-- ---------------------------------------------------------------------------

create table if not exists public.stores_employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  department_id uuid not null references public.stores_departments(id) on delete restrict,
  campus_id uuid references public.campuses(id) on delete set null,
  employee_number text check (employee_number is null or length(btrim(employee_number)) between 1 and 40),
  -- For the school's own records only. Nothing in Stores reads this to send
  -- anything: there is no employee messaging, by design.
  contact_details text check (contact_details is null or length(contact_details) <= 200),
  is_active boolean not null default true,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_profiles(id) on delete set null
);

comment on table public.stores_employees is
  'A directory of the people who collect stock. Not accounts: an employee never signs in, and is never sent a message.';

create unique index if not exists stores_employees_number_key
  on public.stores_employees (lower(btrim(employee_number))) where employee_number is not null;
create index if not exists stores_employees_department_idx on public.stores_employees(department_id);
create index if not exists stores_employees_name_idx on public.stores_employees (lower(full_name));

drop trigger if exists stores_employees_touch on public.stores_employees;
create trigger stores_employees_touch before update on public.stores_employees
  for each row execute function public.stores_touch();

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

create table if not exists public.stores_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text check (description is null or length(description) <= 1000),
  category_id uuid not null references public.stores_categories(id) on delete restrict,
  -- reusable    leaves the storeroom for a while and comes back: checked out
  --             and checked in, with a signature each way.
  -- consumable  issued and used up: deducted, never returned.
  -- asset       leaves the storeroom for good but stays the school's:
  --             assigned to a department or a person, and still on the
  --             register.
  item_type text not null check (item_type in ('reusable', 'consumable', 'asset')),
  unit text not null default 'each' check (length(btrim(unit)) between 1 and 30),
  -- The reorder level. Zero means "do not warn".
  min_stock int not null default 0 check (min_stock >= 0),
  location_id uuid references public.stores_locations(id) on delete restrict,
  -- Thebe. Optional, and only ever used to value what is on the register.
  purchase_price_minor bigint check (purchase_price_minor is null or purchase_price_minor >= 0),
  supplier text check (supplier is null or length(supplier) <= 160),
  is_active boolean not null default true,

  -- The four buckets. No staff grant on any of them: see the column grants
  -- below, and `stores_functions` for the only writers.
  qty_available int not null default 0 check (qty_available >= 0),
  qty_checked_out int not null default 0 check (qty_checked_out >= 0),
  qty_assigned int not null default 0 check (qty_assigned >= 0),
  qty_unavailable int not null default 0 check (qty_unavailable >= 0),
  -- What the school owns, wherever it is. Generated, so "total" can never
  -- disagree with the buckets it is the sum of.
  qty_total int generated always as (qty_available + qty_checked_out + qty_assigned + qty_unavailable) stored,
  -- At or under the reorder level. Generated because the API cannot compare
  -- one column with another, and a low-stock list that is filtered in the
  -- browser is a list that is wrong on page two.
  is_low_stock boolean generated always as (min_stock > 0 and qty_available <= min_stock) stored,

  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff_profiles(id) on delete set null
);

comment on table public.stores_items is
  'The inventory register. One row per item, with its four balances. The balances are written only by the stores_* functions, each of which records a stock movement in the same transaction.';
comment on column public.stores_items.qty_available is 'On the shelf and ready to go out.';
comment on column public.stores_items.qty_checked_out is 'Out on loan, due back.';
comment on column public.stores_items.qty_assigned is 'Permanently assigned to a department or a person. Still the school''s.';
comment on column public.stores_items.qty_unavailable is 'In the storeroom but held back: damaged, missing parts or awaiting maintenance.';

-- Two items with one name cannot be told apart in a picker on a phone.
create unique index if not exists stores_items_name_key on public.stores_items (lower(btrim(name)));
create index if not exists stores_items_category_idx on public.stores_items(category_id);
create index if not exists stores_items_type_idx on public.stores_items(item_type) where is_active;
create index if not exists stores_items_low_idx on public.stores_items(is_low_stock) where is_active and is_low_stock;

-- An item's type decides which movements it may take part in, so it cannot
-- change underneath stock that is out: a "consumable" with five on loan could
-- never be checked back in.
create or replace function public.stores_items_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.item_type is distinct from old.item_type
     and (old.qty_checked_out > 0 or old.qty_assigned > 0) then
    raise exception 'The type of "%" cannot change while some of it is on loan or assigned. Get it back to the storeroom first.', old.name
      using errcode = 'check_violation';
  end if;
  new.updated_at = now();
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

revoke all on function public.stores_items_guard() from public, anon, authenticated;

drop trigger if exists stores_items_guard on public.stores_items;
create trigger stores_items_guard before update on public.stores_items
  for each row execute function public.stores_items_guard();

-- ---------------------------------------------------------------------------
-- A photo of each item
-- ---------------------------------------------------------------------------

-- So the storekeeper can tell the two speakers apart in a picker on a phone.
-- One photo per item, taken with the phone's camera on the item form.
--
-- Held here rather than in a storage bucket: the photo is shrunk on the phone
-- to about a hundred kilobytes, a storeroom holds a few hundred items, and a
-- row under row-level security is private by construction, read only through
-- the console's own route with the person's session. There is no URL that
-- works without one.
--
-- JPEG only, because the phone always re-encodes the photo before it goes
-- (which is also what removes the location a phone writes into it), and the
-- server strips any metadata segment again before saving.
create table if not exists public.stores_item_photos (
  item_id uuid primary key references public.stores_items(id) on delete restrict,
  content_type text not null default 'image/jpeg' check (content_type = 'image/jpeg'),
  bytes bytea not null check (octet_length(bytes) between 100 and 716800 and substring(bytes from 1 for 3) = '\xffd8ff'::bytea),
  -- Set by the trigger below from the bytes themselves, never from the caller.
  sha256 text not null default '',
  width int check (width is null or width between 1 and 4000),
  height int check (height is null or height between 1 and 4000),
  uploaded_by uuid references public.staff_profiles(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

comment on table public.stores_item_photos is
  'One photo per stores item, JPEG, shown beside its name. Read under row-level security through the console only.';

create or replace function public.stores_item_photos_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.sha256 = encode(sha256(new.bytes), 'hex');
  new.uploaded_at = now();
  new.uploaded_by = coalesce(auth.uid(), new.uploaded_by);
  return new;
end;
$$;

revoke all on function public.stores_item_photos_stamp() from public, anon, authenticated;

drop trigger if exists stores_item_photos_stamp on public.stores_item_photos;
create trigger stores_item_photos_stamp before insert or update on public.stores_item_photos
  for each row execute function public.stores_item_photos_stamp();

-- Who changed a photo, without copying the picture into the audit log.
create or replace function public.stores_item_photos_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
  v_row public.stores_item_photos := case when tg_op = 'DELETE' then old else new end;
begin
  select email into v_label from public.staff_profiles where id = auth.uid();
  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, after)
  values (
    case when auth.uid() is null then 'system' else 'staff' end,
    auth.uid(), v_label,
    'stores_item_photos.' || lower(tg_op),
    'stores_items', v_row.item_id,
    jsonb_build_object('sha256', v_row.sha256, 'bytes', octet_length(v_row.bytes))
  );
  return null;
end;
$$;

revoke all on function public.stores_item_photos_audit() from public, anon, authenticated;

drop trigger if exists stores_item_photos_audit on public.stores_item_photos;
create trigger stores_item_photos_audit after insert or update or delete on public.stores_item_photos
  for each row execute function public.stores_item_photos_audit();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.stores_departments enable row level security;
alter table public.stores_categories enable row level security;
alter table public.stores_locations enable row level security;
alter table public.stores_employees enable row level security;
alter table public.stores_items enable row level security;
alter table public.stores_item_photos enable row level security;

-- Read with stores.read. The three settings tables are written by a Stores
-- administrator; the directory by whoever records stock, because the
-- storekeeper has to be able to add the person standing at the hatch.

drop policy if exists stores_departments_select on public.stores_departments;
create policy stores_departments_select on public.stores_departments
  for select using ((select public.has_permission('stores.read')));
drop policy if exists stores_departments_insert on public.stores_departments;
create policy stores_departments_insert on public.stores_departments
  for insert with check ((select public.has_permission('stores.admin')));
drop policy if exists stores_departments_update on public.stores_departments;
create policy stores_departments_update on public.stores_departments
  for update using ((select public.has_permission('stores.admin')))
  with check ((select public.has_permission('stores.admin')));

drop policy if exists stores_categories_select on public.stores_categories;
create policy stores_categories_select on public.stores_categories
  for select using ((select public.has_permission('stores.read')));
drop policy if exists stores_categories_insert on public.stores_categories;
create policy stores_categories_insert on public.stores_categories
  for insert with check ((select public.has_permission('stores.admin')));
drop policy if exists stores_categories_update on public.stores_categories;
create policy stores_categories_update on public.stores_categories
  for update using ((select public.has_permission('stores.admin')))
  with check ((select public.has_permission('stores.admin')));

drop policy if exists stores_locations_select on public.stores_locations;
create policy stores_locations_select on public.stores_locations
  for select using ((select public.has_permission('stores.read')));
drop policy if exists stores_locations_insert on public.stores_locations;
create policy stores_locations_insert on public.stores_locations
  for insert with check ((select public.has_permission('stores.admin')));
drop policy if exists stores_locations_update on public.stores_locations;
create policy stores_locations_update on public.stores_locations
  for update using ((select public.has_permission('stores.admin')))
  with check ((select public.has_permission('stores.admin')));

drop policy if exists stores_employees_select on public.stores_employees;
create policy stores_employees_select on public.stores_employees
  for select using ((select public.has_permission('stores.read')));
drop policy if exists stores_employees_insert on public.stores_employees;
create policy stores_employees_insert on public.stores_employees
  for insert with check ((select public.has_permission('stores.write')));
drop policy if exists stores_employees_update on public.stores_employees;
create policy stores_employees_update on public.stores_employees
  for update using ((select public.has_permission('stores.write')))
  with check ((select public.has_permission('stores.write')));

drop policy if exists stores_items_select on public.stores_items;
create policy stores_items_select on public.stores_items
  for select using ((select public.has_permission('stores.read')));
-- No insert policy: an item is created by `stores_create_item()`, which
-- records its opening balance as a movement in the same transaction.
drop policy if exists stores_items_update on public.stores_items;
create policy stores_items_update on public.stores_items
  for update using ((select public.has_permission('stores.write')))
  with check ((select public.has_permission('stores.write')));

-- A photo is the storekeeper's to take, replace or remove: it is a picture
-- of the item, not part of its history.
drop policy if exists stores_item_photos_select on public.stores_item_photos;
create policy stores_item_photos_select on public.stores_item_photos
  for select using ((select public.has_permission('stores.read')));
drop policy if exists stores_item_photos_insert on public.stores_item_photos;
create policy stores_item_photos_insert on public.stores_item_photos
  for insert with check ((select public.has_permission('stores.write')));
drop policy if exists stores_item_photos_update on public.stores_item_photos;
create policy stores_item_photos_update on public.stores_item_photos
  for update using ((select public.has_permission('stores.write')))
  with check ((select public.has_permission('stores.write')));
drop policy if exists stores_item_photos_delete on public.stores_item_photos;
create policy stores_item_photos_delete on public.stores_item_photos
  for delete using ((select public.has_permission('stores.write')));
revoke all on public.stores_item_photos from anon;

-- No delete policy on any of the five, and that is the decision: history
-- names these rows. Switch one off instead.

-- A policy sees a row, not a diff, so it cannot say "these columns are
-- read-only". A column grant can. Staff may edit what an item is called and
-- where it is kept; how many there are belongs to the functions.
revoke insert, update, delete on public.stores_items from anon, authenticated;
grant update (
  name,
  description,
  category_id,
  item_type,
  unit,
  min_stock,
  location_id,
  purchase_price_minor,
  supplier,
  is_active
) on public.stores_items to authenticated;

revoke delete on public.stores_departments, public.stores_categories, public.stores_locations, public.stores_employees from anon, authenticated;
revoke insert, update on public.stores_departments, public.stores_categories, public.stores_locations, public.stores_employees from anon;

-- ---------------------------------------------------------------------------
-- Seed: what a storeroom needs before its first movement
-- ---------------------------------------------------------------------------

-- The categories the school listed. An administrator may add to them.
insert into public.stores_categories (name, sort_order)
select v.name, v.sort_order
  from (values
    ('Marketing', 10),
    ('Sports Equipment', 20),
    ('Cleaning Equipment', 30),
    ('Cleaning Consumables', 40),
    ('Stationery', 50),
    ('General Equipment', 60),
    ('Event Equipment', 70),
    ('Other', 80)
  ) as v(name, sort_order)
 where not exists (select 1 from public.stores_categories c where lower(btrim(c.name)) = lower(v.name));

-- One storeroom. Block 7, Broadhurst, Tlokweng and the sports store are added
-- in Settings on the day they hold stock of their own.
insert into public.stores_locations (name, sort_order)
select 'Main Storeroom', 10
 where not exists (select 1 from public.stores_locations);

-- A short list to start from, so the storekeeper can record the first person
-- at the hatch without waiting for somebody to configure the school. Every
-- name is the administrator's to change in Settings.
insert into public.stores_departments (name)
select v.name
  from (values ('Administration'), ('Academic Staff'), ('Marketing'), ('Sports'), ('Cleaning'), ('Maintenance')) as v(name)
 where not exists (select 1 from public.stores_departments);
