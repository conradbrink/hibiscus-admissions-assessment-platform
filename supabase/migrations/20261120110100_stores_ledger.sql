-- Hibiscus Stores: the transactions, the movement ledger and the signatures.
--
-- Every change to a balance in `stores_items` is one of these:
--
--   stores_receipts        stock bought or delivered; an item's opening stock
--   stores_checkouts       equipment lent to an employee, signed for
--   stores_returns         equipment handed back, signed for, part or whole
--   stores_issues          consumables handed out and used up
--   stores_assignments     equipment placed with a department for good
--   stores_asset_returns   an assigned item brought back to the storeroom
--   stores_adjustments     a documented correction: a count, damage found on
--                          the shelf, a repair, a write-off
--   stores_reversals       a documented undo of one of the above
--
-- and each writes one line per item into `stores_movements`, which is the
-- whole history of the storeroom. A movement carries the change it made to
-- each of the four buckets, so for every item
--
--   sum(available_delta) = qty_available, and likewise for the other three.
--
-- `stores_reconciliation()` asserts exactly that, and the security suite runs
-- it after every case.
--
-- Nobody writes any of these tables directly. Staff have no insert, update or
-- delete grant, and there are no write policies. The functions at the end of
-- this file are the only writers. They are `security definer` for the same
-- reason `crm_merge_families()` is: they write balance columns that no staff
-- role is granted, so they check the caller themselves — `auth.uid()` and
-- `has_permission()` first, before anything else — and they pin their
-- search path. The actor recorded on every row is `auth.uid()`, which the
-- caller cannot choose.
--
-- History is never rewritten:
--
--   * `stores_movements` and `stores_signatures` refuse every update and
--     delete, for every role including the service role, with one exception:
--     the `on delete set null` a deleted staff account causes. The name of
--     the person who recorded a row is copied onto it, so it still reads
--     correctly afterwards.
--   * A transaction that was wrong is not edited. It is reversed, with a
--     reason, by a Stores administrator, and the reversal is its own
--     reference, its own movements and its own row.
--   * Every write takes a request id chosen by the browser, unique per
--     table. A second tap on Confirm, a retried request or a page restored
--     from history gets the first result back and moves nothing.

-- ---------------------------------------------------------------------------
-- Reference numbers: CO-2026-00001
-- ---------------------------------------------------------------------------

create table if not exists public.stores_counters (
  prefix text not null,
  year int not null,
  last_value int not null default 0,
  primary key (prefix, year)
);

alter table public.stores_counters enable row level security;
-- No policies: only `stores_next_reference()` reads or writes it.
revoke all on public.stores_counters from anon, authenticated;

create or replace function public.stores_next_reference(p_prefix text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year int := extract(year from (now() at time zone 'Africa/Gaborone'))::int;
  v_n int;
begin
  insert into public.stores_counters (prefix, year, last_value)
  values (p_prefix, v_year, 1)
  on conflict (prefix, year) do update set last_value = public.stores_counters.last_value + 1
  returning last_value into v_n;
  return p_prefix || '-' || v_year::text || '-' || lpad(v_n::text, 5, '0');
end;
$$;

revoke all on function public.stores_next_reference(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What counts as a signature
-- ---------------------------------------------------------------------------

-- A drawn signature, checked by the database as well as by the server
-- action: `{"w": …, "h": …, "strokes": [[[x, y], …], …]}`, the strokes in a
-- box the pad's own shape, so a tall pad on a phone replays exactly as it was
-- drawn rather than squashed into a fixed rectangle. Points inside the box,
-- a bounded number of them, and enough ink to be a mark rather than a tap:
-- the same idea as `web/lib/registration/signature.ts`, sized to the box.
create or replace function public.stores_signature_ok(p_signature jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_w numeric;
  v_h numeric;
  v_strokes jsonb;
  v_stroke jsonb;
  v_point jsonb;
  v_points int := 0;
  v_ink numeric := 0;
  v_x numeric;
  v_y numeric;
  v_px numeric;
  v_py numeric;
  v_first boolean;
begin
  if p_signature is null or jsonb_typeof(p_signature) <> 'object'
     or (select count(*) from jsonb_object_keys(p_signature)) <> 3
     or jsonb_typeof(p_signature -> 'w') is distinct from 'number'
     or jsonb_typeof(p_signature -> 'h') is distinct from 'number' then
    return false;
  end if;
  v_w := (p_signature ->> 'w')::numeric;
  v_h := (p_signature ->> 'h')::numeric;
  if v_w < 200 or v_w > 1200 or v_h < 100 or v_h > 1200 then
    return false;
  end if;
  v_strokes := p_signature -> 'strokes';
  if v_strokes is null or jsonb_typeof(v_strokes) <> 'array'
     or jsonb_array_length(v_strokes) = 0 or jsonb_array_length(v_strokes) > 200 then
    return false;
  end if;
  for v_stroke in select value from jsonb_array_elements(v_strokes) loop
    if jsonb_typeof(v_stroke) <> 'array' or jsonb_array_length(v_stroke) = 0 then
      return false;
    end if;
    v_first := true;
    for v_point in select value from jsonb_array_elements(v_stroke) loop
      if jsonb_typeof(v_point) <> 'array' or jsonb_array_length(v_point) <> 2
         or jsonb_typeof(v_point -> 0) <> 'number' or jsonb_typeof(v_point -> 1) <> 'number' then
        return false;
      end if;
      v_points := v_points + 1;
      if v_points > 6000 then
        return false;
      end if;
      v_x := (v_point ->> 0)::numeric;
      v_y := (v_point ->> 1)::numeric;
      if v_x < 0 or v_x > v_w or v_y < 0 or v_y > v_h then
        return false;
      end if;
      if not v_first then
        v_ink := v_ink + sqrt((v_x - v_px) ^ 2 + (v_y - v_py) ^ 2);
      end if;
      v_px := v_x;
      v_py := v_y;
      v_first := false;
    end loop;
  end loop;
  -- 80 units of ink in a 600-wide box, in proportion for any other width.
  return v_ink >= v_w * 80 / 600;
end;
$$;

revoke all on function public.stores_signature_ok(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings: the words an employee signs
-- ---------------------------------------------------------------------------

-- The acknowledgements are data, not code, for the same reason every email
-- is: the school owns the wording. The signing screen shows the current text,
-- the function refuses a signature over any other text, and the signature row
-- keeps the text that was on the screen. Editing the setting later changes
-- what the next person signs and nothing about what anybody already signed.
insert into public.settings (key, value, description) values
  ('stores_checkout_acknowledgement',
   to_jsonb('I acknowledge receipt of the equipment listed above from Hibiscus Schools and accept responsibility for returning it on the specified date.'::text),
   'Hibiscus Stores: the statement an employee signs when equipment is checked out to them.'),
  ('stores_return_acknowledgement',
   to_jsonb('I acknowledge that the equipment listed above has been handed back to Hibiscus Schools and recorded as returned.'::text),
   'Hibiscus Stores: the statement an employee signs when they return equipment.'),
  ('stores_due_soon_days', '2',
   'Hibiscus Stores: equipment due back within this many days is shown in amber.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Reversals (first, because every transaction table points at one)
-- ---------------------------------------------------------------------------

create table if not exists public.stores_reversals (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_id uuid not null unique,
  target_kind text not null check (target_kind in ('receipt', 'checkout', 'return', 'issue', 'assignment')),
  target_id uuid not null,
  target_reference text not null,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null,
  -- One reversal per transaction. Undoing a reversal is a new transaction.
  unique (target_kind, target_id)
);

comment on table public.stores_reversals is
  'A documented undo of a stores transaction, by a Stores administrator, with a reason. The original rows are kept and marked; nothing is edited.';

-- ---------------------------------------------------------------------------
-- Receipts
-- ---------------------------------------------------------------------------

create table if not exists public.stores_receipts (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_id uuid not null unique,
  item_id uuid not null references public.stores_items(id) on delete restrict,
  item_name text not null,
  -- Zero only for the opening receipt of an item that starts empty.
  quantity int not null,
  received_on date not null,
  supplier text check (supplier is null or length(supplier) <= 160),
  unit_price_minor bigint check (unit_price_minor is null or unit_price_minor >= 0),
  invoice_ref text check (invoice_ref is null or length(invoice_ref) <= 80),
  notes text check (notes is null or length(notes) <= 1000),
  -- The quantity an item started with when it was added to the register.
  is_opening boolean not null default false,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null,
  reversal_id uuid references public.stores_reversals(id) on delete restrict,
  check (quantity > 0 or (is_opening and quantity = 0))
);

create index if not exists stores_receipts_item_idx on public.stores_receipts(item_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Checkouts and returns
-- ---------------------------------------------------------------------------

create table if not exists public.stores_checkouts (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_id uuid not null unique,
  employee_id uuid not null references public.stores_employees(id) on delete restrict,
  -- Copied at the time, so a later rename or move does not rewrite who
  -- signed for what.
  employee_name text not null,
  department_id uuid references public.stores_departments(id) on delete restrict,
  department_name text,
  checked_out_at timestamptz not null default now(),
  expected_return_date date not null,
  status text not null default 'open' check (status in ('open', 'completed', 'reversed')),
  completed_at timestamptz,
  notes text check (notes is null or length(notes) <= 1000),
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null,
  reversal_id uuid references public.stores_reversals(id) on delete restrict
);

create index if not exists stores_checkouts_open_idx on public.stores_checkouts(expected_return_date) where status = 'open';
create index if not exists stores_checkouts_employee_idx on public.stores_checkouts(employee_id, checked_out_at desc);

create table if not exists public.stores_checkout_lines (
  id uuid primary key default gen_random_uuid(),
  checkout_id uuid not null references public.stores_checkouts(id) on delete restrict,
  item_id uuid not null references public.stores_items(id) on delete restrict,
  item_name text not null,
  unit text not null,
  quantity int not null check (quantity > 0),
  quantity_returned int not null default 0 check (quantity_returned >= 0),
  -- Formally adjusted by an administrator: lost, or not coming back.
  quantity_written_off int not null default 0 check (quantity_written_off >= 0),
  quantity_outstanding int generated always as (quantity - quantity_returned - quantity_written_off) stored,
  check (quantity_returned + quantity_written_off <= quantity),
  unique (checkout_id, item_id)
);

create index if not exists stores_checkout_lines_item_idx on public.stores_checkout_lines(item_id) where quantity_outstanding > 0;

create table if not exists public.stores_returns (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_id uuid not null unique,
  checkout_id uuid not null references public.stores_checkouts(id) on delete restrict,
  employee_id uuid not null references public.stores_employees(id) on delete restrict,
  employee_name text not null,
  returned_at timestamptz not null default now(),
  notes text check (notes is null or length(notes) <= 1000),
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null,
  reversal_id uuid references public.stores_reversals(id) on delete restrict
);

create index if not exists stores_returns_checkout_idx on public.stores_returns(checkout_id, returned_at);

create table if not exists public.stores_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.stores_returns(id) on delete restrict,
  checkout_line_id uuid not null references public.stores_checkout_lines(id) on delete restrict,
  item_id uuid not null references public.stores_items(id) on delete restrict,
  item_name text not null,
  unit text not null,
  quantity int not null check (quantity > 0),
  -- good goes back on the shelf; the other three are held as unavailable
  -- until repaired or written off.
  condition text not null check (condition in ('good', 'damaged', 'missing_parts', 'needs_maintenance')),
  note text check (note is null or length(note) <= 500),
  unique (return_id, checkout_line_id)
);

-- ---------------------------------------------------------------------------
-- Signatures
-- ---------------------------------------------------------------------------

-- What the employee drew, as numbers -- the pad's box and the strokes in it --
-- and never markup: the console renders the SVG from them at display time,
-- so nothing a browser sent is ever stored as something a browser will parse.
-- Read under row-level security and shown inline; there is no URL to share.
create table if not exists public.stores_signatures (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('checkout', 'return')),
  checkout_id uuid not null references public.stores_checkouts(id) on delete restrict,
  return_id uuid references public.stores_returns(id) on delete restrict,
  employee_id uuid not null references public.stores_employees(id) on delete restrict,
  employee_name text not null,
  -- {"w": …, "h": …, "strokes": [[[x, y], …], …]}, checked by stores_signature_ok.
  drawing jsonb not null check (public.stores_signature_ok(drawing)),
  -- The statement on the screen, word for word.
  acknowledgement text not null,
  -- What else was on the screen: the items, quantities, dates and
  -- conditions. `summary_hash` is its SHA-256, so a later reader can show
  -- that the record has not been altered since it was signed.
  summary jsonb not null,
  summary_hash text not null,
  signed_at timestamptz not null default now(),
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null,
  check ((kind = 'checkout' and return_id is null) or (kind = 'return' and return_id is not null))
);

comment on table public.stores_signatures is
  'An employee''s handwritten acknowledgement of a handover or a return, captured on the storekeeper''s device. Append-only for every role.';

create unique index if not exists stores_signatures_checkout_key on public.stores_signatures(checkout_id) where kind = 'checkout';
create unique index if not exists stores_signatures_return_key on public.stores_signatures(return_id) where kind = 'return';

-- ---------------------------------------------------------------------------
-- Consumable issues
-- ---------------------------------------------------------------------------

create table if not exists public.stores_issues (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_id uuid not null unique,
  employee_id uuid not null references public.stores_employees(id) on delete restrict,
  employee_name text not null,
  department_id uuid references public.stores_departments(id) on delete restrict,
  department_name text,
  issued_at timestamptz not null default now(),
  notes text check (notes is null or length(notes) <= 1000),
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null,
  reversal_id uuid references public.stores_reversals(id) on delete restrict
);

create index if not exists stores_issues_issued_idx on public.stores_issues(issued_at desc);

create table if not exists public.stores_issue_lines (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.stores_issues(id) on delete restrict,
  item_id uuid not null references public.stores_items(id) on delete restrict,
  item_name text not null,
  unit text not null,
  quantity int not null check (quantity > 0),
  unique (issue_id, item_id)
);

-- ---------------------------------------------------------------------------
-- Permanent assignments
-- ---------------------------------------------------------------------------

create table if not exists public.stores_assignments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_id uuid not null unique,
  item_id uuid not null references public.stores_items(id) on delete restrict,
  item_name text not null,
  unit text not null,
  quantity int not null check (quantity > 0),
  quantity_returned int not null default 0 check (quantity_returned >= 0 and quantity_returned <= quantity),
  quantity_held int generated always as (quantity - quantity_returned) stored,
  -- Always a department, so the register can say where every asset is;
  -- a responsible person when there is one.
  department_id uuid not null references public.stores_departments(id) on delete restrict,
  department_name text not null,
  employee_id uuid references public.stores_employees(id) on delete restrict,
  employee_name text,
  -- Where it now lives, in the school's words: "Block 7", "Marketing office".
  location_note text check (location_note is null or length(location_note) <= 160),
  assigned_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'returned', 'reversed')),
  returned_at timestamptz,
  notes text check (notes is null or length(notes) <= 1000),
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null,
  reversal_id uuid references public.stores_reversals(id) on delete restrict
);

create index if not exists stores_assignments_active_idx on public.stores_assignments(item_id) where status = 'active';

create table if not exists public.stores_asset_returns (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_id uuid not null unique,
  assignment_id uuid not null references public.stores_assignments(id) on delete restrict,
  item_id uuid not null references public.stores_items(id) on delete restrict,
  item_name text not null,
  quantity int not null check (quantity > 0),
  condition text not null check (condition in ('good', 'damaged', 'missing_parts', 'needs_maintenance')),
  notes text check (notes is null or length(notes) <= 1000),
  returned_at timestamptz not null default now(),
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null
);

-- ---------------------------------------------------------------------------
-- Adjustments
-- ---------------------------------------------------------------------------

create table if not exists public.stores_adjustments (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  request_id uuid not null unique,
  item_id uuid not null references public.stores_items(id) on delete restrict,
  item_name text not null,
  -- count_correction       a stock count found more or fewer on the shelf
  -- mark_damaged           found damaged on the shelf: held back
  -- repaired               held back, now fixed: on the shelf again
  -- write_off              held back and beyond repair: gone
  -- write_off_outstanding  on loan and not coming back: gone, and the
  --                        checkout line closed for that quantity
  kind text not null check (kind in ('count_correction', 'mark_damaged', 'repaired', 'write_off', 'write_off_outstanding')),
  quantity int not null check (quantity > 0),
  available_delta int not null default 0,
  checked_out_delta int not null default 0,
  unavailable_delta int not null default 0,
  checkout_line_id uuid references public.stores_checkout_lines(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 3 and 500),
  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null,
  check ((kind = 'write_off_outstanding') = (checkout_line_id is not null))
);

create index if not exists stores_adjustments_item_idx on public.stores_adjustments(item_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table if not exists public.stores_movements (
  -- bigint identity, as `audit_log` is: an append-only log that callers
  -- order by, where two rows in the same millisecond still have an order.
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  movement_type text not null check (movement_type in (
    'received', 'checked_out', 'returned', 'issued', 'assigned',
    'asset_returned', 'adjustment', 'transfer', 'reversal'
  )),
  reference text not null,
  item_id uuid not null references public.stores_items(id) on delete restrict,
  item_name text not null,
  -- How many units the line is about, always positive. The signed changes to
  -- the buckets are below, and are what the balances are the sum of.
  quantity int not null check (quantity > 0),
  available_delta int not null default 0,
  checked_out_delta int not null default 0,
  assigned_delta int not null default 0,
  unavailable_delta int not null default 0,
  employee_id uuid references public.stores_employees(id) on delete restrict,
  employee_name text,
  department_id uuid references public.stores_departments(id) on delete restrict,
  department_name text,
  condition text check (condition is null or condition in ('good', 'damaged', 'missing_parts', 'needs_maintenance')),
  notes text,
  -- The transaction the line belongs to. A reversal's lines carry the
  -- original's link as well as their own, so "everything that happened to
  -- checkout CO-…" is one filter.
  receipt_id uuid references public.stores_receipts(id) on delete restrict,
  checkout_id uuid references public.stores_checkouts(id) on delete restrict,
  return_id uuid references public.stores_returns(id) on delete restrict,
  issue_id uuid references public.stores_issues(id) on delete restrict,
  assignment_id uuid references public.stores_assignments(id) on delete restrict,
  asset_return_id uuid references public.stores_asset_returns(id) on delete restrict,
  adjustment_id uuid references public.stores_adjustments(id) on delete restrict,
  reversal_id uuid references public.stores_reversals(id) on delete restrict,
  reverses_movement_id bigint references public.stores_movements(id) on delete restrict,
  recorded_by uuid references public.staff_profiles(id) on delete set null,
  recorded_by_name text not null,
  -- A line that moves nothing is a line that should not exist.
  check (available_delta <> 0 or checked_out_delta <> 0 or assigned_delta <> 0 or unavailable_delta <> 0)
);

comment on table public.stores_movements is
  'Every change to every stores balance, one line per item. Append-only for every role. For each item the deltas sum to its four balances; stores_reconciliation() proves it.';

create index if not exists stores_movements_item_idx on public.stores_movements(item_id, id desc);
create index if not exists stores_movements_occurred_idx on public.stores_movements(occurred_at desc);
create index if not exists stores_movements_employee_idx on public.stores_movements(employee_id, occurred_at desc) where employee_id is not null;
create index if not exists stores_movements_department_idx on public.stores_movements(department_id, occurred_at desc) where department_id is not null;
create index if not exists stores_movements_type_idx on public.stores_movements(movement_type, occurred_at desc);
create index if not exists stores_movements_checkout_idx on public.stores_movements(checkout_id) where checkout_id is not null;
create index if not exists stores_movements_return_idx on public.stores_movements(return_id) where return_id is not null;
create index if not exists stores_movements_issue_idx on public.stores_movements(issue_id) where issue_id is not null;
create index if not exists stores_movements_receipt_idx on public.stores_movements(receipt_id) where receipt_id is not null;
create index if not exists stores_movements_assignment_idx on public.stores_movements(assignment_id) where assignment_id is not null;

-- ---------------------------------------------------------------------------
-- Append-only, for everybody
-- ---------------------------------------------------------------------------

-- A trigger rather than a policy, because it binds the service role too, as
-- `admission_decisions_immutable` does. The one change allowed is the one a
-- foreign key makes on its own: a deleted staff account's id becoming null.
-- The row keeps that person's name in `recorded_by_name`.
create or replace function public.stores_append_only()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and old.recorded_by is not null and new.recorded_by is null
     and (to_jsonb(new) - 'recorded_by') = (to_jsonb(old) - 'recorded_by') then
    return new;
  end if;
  raise exception 'The stores history cannot be changed. Record a correction or a reversal instead.'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.stores_append_only() from public, anon, authenticated;

drop trigger if exists stores_movements_append_only on public.stores_movements;
create trigger stores_movements_append_only
  before update or delete on public.stores_movements
  for each row execute function public.stores_append_only();

drop trigger if exists stores_signatures_append_only on public.stores_signatures;
create trigger stores_signatures_append_only
  before update or delete on public.stores_signatures
  for each row execute function public.stores_append_only();

-- The transactions themselves change in exactly the ways the functions
-- change them (a return closes a checkout, a reversal marks its target) and
-- are never deleted.
create or replace function public.stores_no_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Stores transactions are never deleted. Reverse one instead, with a reason.'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.stores_no_delete() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'stores_reversals', 'stores_receipts', 'stores_checkouts', 'stores_checkout_lines',
    'stores_returns', 'stores_return_lines', 'stores_issues', 'stores_issue_lines',
    'stores_assignments', 'stores_asset_returns', 'stores_adjustments'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_delete', t);
    execute format('create trigger %I before delete on public.%I for each row execute function public.stores_no_delete()', t || '_no_delete', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- RLS: read with stores.read, write through the functions only
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'stores_reversals', 'stores_receipts', 'stores_checkouts', 'stores_checkout_lines',
    'stores_returns', 'stores_return_lines', 'stores_signatures', 'stores_issues',
    'stores_issue_lines', 'stores_assignments', 'stores_asset_returns', 'stores_adjustments',
    'stores_movements'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select using ((select public.has_permission(%L)))', t || '_select', t, 'stores.read');
    -- No insert, update or delete policy, and no grant either, so the
    -- refusal does not depend on a policy being absent.
    execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Helpers the functions share
-- ---------------------------------------------------------------------------

-- Who is asking, refused unless they hold the permission. Returns the name
-- recorded against what they do.
create or replace function public.stores_actor(p_permission text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
begin
  if auth.uid() is null or not public.has_permission(p_permission) then
    raise exception 'You do not have permission to do that.' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(nullif(btrim(full_name), ''), email) into v_name
    from public.staff_profiles where id = auth.uid() and is_active;
  if v_name is null then
    raise exception 'You do not have permission to do that.' using errcode = 'insufficient_privilege';
  end if;
  return v_name;
end;
$$;

revoke all on function public.stores_actor(text) from public, anon, authenticated;

-- Today in the school's calendar, which is the one a return date is in.
create or replace function public.stores_today()
returns date
language sql
stable
set search_path = public, pg_temp
as $$
  select (now() at time zone 'Africa/Gaborone')::date
$$;

revoke all on function public.stores_today() from public, anon;
grant execute on function public.stores_today() to authenticated;


-- A short text argument, trimmed, null when empty, refused when too long.
create or replace function public.stores_text(p_value text, p_max int, p_label text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is not null and length(v) > p_max then
    raise exception '% is too long: % characters at most.', p_label, p_max using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

revoke all on function public.stores_text(text, int, text) from public, anon, authenticated;

-- The acknowledgement a signature must be over: the current setting, and
-- exactly the words the screen showed.
create or replace function public.stores_acknowledgement(p_key text, p_shown text)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  select value #>> '{}' into v from public.settings where key = p_key;
  if v is null or btrim(v) = '' then
    raise exception 'The acknowledgement wording is missing from Settings.' using errcode = 'check_violation';
  end if;
  if p_shown is distinct from v then
    raise exception 'The acknowledgement wording has changed since this screen opened. Reload the page and sign again.'
      using errcode = 'check_violation';
  end if;
  return v;
end;
$$;

revoke all on function public.stores_acknowledgement(text, text) from public, anon, authenticated;

-- Parses `[{"item_id": …, "quantity": n}, …]`, adding together two lines for
-- the same item, and refuses anything that is not a positive whole number.
create or replace function public.stores_item_lines(p_lines jsonb)
returns table (item_id uuid, quantity int)
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_line jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one item.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'One transaction can hold 50 items at most.' using errcode = 'check_violation';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line -> 'quantity') <> 'number'
       or (v_line ->> 'quantity')::numeric <> trunc((v_line ->> 'quantity')::numeric)
       or (v_line ->> 'quantity')::numeric < 1
       or (v_line ->> 'quantity')::numeric > 100000 then
      raise exception 'Every quantity must be a whole number greater than zero.' using errcode = 'check_violation';
    end if;
    if (v_line ->> 'item_id') is null
       or (v_line ->> 'item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'An item was not recognised.' using errcode = 'check_violation';
    end if;
  end loop;
  return query
    select (l ->> 'item_id')::uuid, sum((l ->> 'quantity')::numeric)::int
      from jsonb_array_elements(p_lines) l
     group by (l ->> 'item_id')::uuid;
end;
$$;

revoke all on function public.stores_item_lines(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create an item, with its opening stock as its first receipt
-- ---------------------------------------------------------------------------

create or replace function public.stores_create_item(
  p_request_id uuid,
  p_name text,
  p_category_id uuid,
  p_item_type text,
  p_unit text default 'each',
  p_description text default null,
  p_min_stock int default 0,
  p_location_id uuid default null,
  p_purchase_price_minor bigint default null,
  p_supplier text default null,
  p_opening_quantity int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := public.stores_actor('stores.write');
  v_item public.stores_items;
  v_receipt uuid;
  v_ref text;
  v_name text := public.stores_text(p_name, 120, 'The name');
begin
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  -- The same request, again: the item it made.
  select i.* into v_item from public.stores_receipts r join public.stores_items i on i.id = r.item_id
   where r.request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_item.id, 'name', v_item.name, 'replayed', true);
  end if;
  if v_name is null then
    raise exception 'Give the item a name.' using errcode = 'check_violation';
  end if;
  if p_item_type is null or p_item_type not in ('reusable', 'consumable', 'asset') then
    raise exception 'Choose what kind of item this is.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.stores_categories where id = p_category_id and is_active) then
    raise exception 'Choose a category.' using errcode = 'check_violation';
  end if;
  if p_location_id is not null and not exists (select 1 from public.stores_locations where id = p_location_id and is_active) then
    raise exception 'That storage place is not in use.' using errcode = 'check_violation';
  end if;
  if coalesce(p_opening_quantity, 0) < 0 or coalesce(p_opening_quantity, 0) > 1000000 then
    raise exception 'The opening quantity must be zero or more.' using errcode = 'check_violation';
  end if;
  if coalesce(p_min_stock, 0) < 0 then
    raise exception 'The reorder level must be zero or more.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.stores_items where lower(btrim(name)) = lower(v_name)) then
    raise exception 'An item called "%" is already on the register.', v_name using errcode = 'unique_violation';
  end if;

  insert into public.stores_items (
    name, description, category_id, item_type, unit, min_stock, location_id,
    purchase_price_minor, supplier, created_by, updated_by
  ) values (
    v_name,
    public.stores_text(p_description, 1000, 'The description'),
    p_category_id,
    p_item_type,
    coalesce(public.stores_text(p_unit, 30, 'The unit'), 'each'),
    coalesce(p_min_stock, 0),
    coalesce(p_location_id, (select id from public.stores_locations where is_active order by sort_order, name limit 1)),
    p_purchase_price_minor,
    public.stores_text(p_supplier, 160, 'The supplier'),
    auth.uid(),
    auth.uid()
  ) returning * into v_item;

  -- Every item has a receipt, even one that starts at zero, because the
  -- receipt carries the request id that makes a second tap harmless.
  v_ref := public.stores_next_reference('RC');
  insert into public.stores_receipts (
    reference, request_id, item_id, item_name, quantity, received_on, supplier,
    unit_price_minor, notes, is_opening, recorded_by, recorded_by_name
  ) values (
    v_ref, p_request_id, v_item.id, v_item.name, coalesce(p_opening_quantity, 0),
    public.stores_today(), v_item.supplier, p_purchase_price_minor, 'Opening stock', true, auth.uid(), v_actor
  ) returning id into v_receipt;

  if coalesce(p_opening_quantity, 0) > 0 then
    update public.stores_items set qty_available = qty_available + p_opening_quantity where id = v_item.id;
    insert into public.stores_movements (
      movement_type, reference, item_id, item_name, quantity, available_delta,
      notes, receipt_id, recorded_by, recorded_by_name
    ) values (
      'received', v_ref, v_item.id, v_item.name, p_opening_quantity, p_opening_quantity,
      'Opening stock', v_receipt, auth.uid(), v_actor
    );
  end if;

  return jsonb_build_object('id', v_item.id, 'name', v_item.name, 'reference', v_ref);
end;
$$;

-- ---------------------------------------------------------------------------
-- Receive stock
-- ---------------------------------------------------------------------------

create or replace function public.stores_receive(
  p_request_id uuid,
  p_item_id uuid,
  p_quantity int,
  p_received_on date default null,
  p_supplier text default null,
  p_unit_price_minor bigint default null,
  p_invoice_ref text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := public.stores_actor('stores.write');
  v_item public.stores_items;
  v_id uuid;
  v_ref text;
  v_on date := coalesce(p_received_on, public.stores_today());
  v_supplier text := public.stores_text(p_supplier, 160, 'The supplier');
begin
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  select id, reference into v_id, v_ref from public.stores_receipts where request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', true);
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000000 then
    raise exception 'The quantity received must be a whole number greater than zero.' using errcode = 'check_violation';
  end if;
  if v_on > public.stores_today() then
    raise exception 'Stock cannot be received on a date that has not come yet.' using errcode = 'check_violation';
  end if;
  if p_unit_price_minor is not null and p_unit_price_minor < 0 then
    raise exception 'The price cannot be negative.' using errcode = 'check_violation';
  end if;

  select * into v_item from public.stores_items where id = p_item_id for update;
  if not found then
    raise exception 'That item is not on the register.' using errcode = 'no_data_found';
  end if;
  if not v_item.is_active then
    raise exception '"%" is switched off. Switch it on before receiving stock for it.', v_item.name using errcode = 'check_violation';
  end if;

  v_ref := public.stores_next_reference('RC');
  insert into public.stores_receipts (
    reference, request_id, item_id, item_name, quantity, received_on, supplier,
    unit_price_minor, invoice_ref, notes, recorded_by, recorded_by_name
  ) values (
    v_ref, p_request_id, v_item.id, v_item.name, p_quantity, v_on, v_supplier,
    p_unit_price_minor, public.stores_text(p_invoice_ref, 80, 'The invoice reference'),
    public.stores_text(p_notes, 1000, 'The note'), auth.uid(), v_actor
  ) returning id into v_id;

  -- The latest price and supplier become the item's, so the valuation
  -- report reads what the school last paid.
  update public.stores_items
     set qty_available = qty_available + p_quantity,
         purchase_price_minor = coalesce(p_unit_price_minor, purchase_price_minor),
         supplier = coalesce(v_supplier, supplier)
   where id = v_item.id;

  insert into public.stores_movements (
    movement_type, reference, item_id, item_name, quantity, available_delta,
    notes, receipt_id, recorded_by, recorded_by_name
  ) values (
    'received', v_ref, v_item.id, v_item.name, p_quantity, p_quantity,
    public.stores_text(p_notes, 1000, 'The note'), v_id, auth.uid(), v_actor
  );

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$$;

-- ---------------------------------------------------------------------------
-- Check out
-- ---------------------------------------------------------------------------

create or replace function public.stores_checkout(
  p_request_id uuid,
  p_employee_id uuid,
  p_expected_return_date date,
  p_lines jsonb,
  p_signature jsonb,
  p_acknowledgement text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := public.stores_actor('stores.write');
  v_emp record;
  v_id uuid;
  v_ref text;
  v_ack text;
  v_line record;
  v_items jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_now timestamptz := now();
begin
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  select id, reference into v_id, v_ref from public.stores_checkouts where request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', true);
  end if;

  select e.id, e.full_name, e.is_active, e.department_id, d.name as department_name
    into v_emp
    from public.stores_employees e
    left join public.stores_departments d on d.id = e.department_id
   where e.id = p_employee_id;
  if not found then
    raise exception 'Choose the employee who is collecting the equipment.' using errcode = 'check_violation';
  end if;
  if not v_emp.is_active then
    raise exception '% is no longer active in the directory.', v_emp.full_name using errcode = 'check_violation';
  end if;
  if p_expected_return_date is null then
    raise exception 'Choose the date the equipment is due back.' using errcode = 'check_violation';
  end if;
  if p_expected_return_date < public.stores_today() then
    raise exception 'The return date cannot be in the past.' using errcode = 'check_violation';
  end if;
  if not public.stores_signature_ok(p_signature) then
    raise exception 'The employee must sign before the checkout can be completed.' using errcode = 'check_violation';
  end if;
  v_ack := public.stores_acknowledgement('stores_checkout_acknowledgement', p_acknowledgement);

  -- Lock every item in one order, so two checkouts of the same projector
  -- queue behind each other instead of both reading "1 available".
  perform 1 from public.stores_items i
    where i.id in (select l.item_id from public.stores_item_lines(p_lines) l)
    order by i.id for update;

  for v_line in
    select l.item_id, l.quantity, i.name, i.unit, i.item_type, i.is_active, i.qty_available, i.qty_unavailable
      from public.stores_item_lines(p_lines) l
      left join public.stores_items i on i.id = l.item_id
     order by i.name
  loop
    if v_line.name is null then
      raise exception 'An item was not recognised.' using errcode = 'check_violation';
    end if;
    if not v_line.is_active then
      raise exception '"%" is switched off and cannot be checked out.', v_line.name using errcode = 'check_violation';
    end if;
    if v_line.item_type <> 'reusable' then
      raise exception '"%" is not equipment that comes back. Use Stock Issues for it.', v_line.name using errcode = 'check_violation';
    end if;
    if v_line.quantity > v_line.qty_available then
      if v_line.qty_available = 0 and v_line.qty_unavailable > 0 then
        raise exception 'None of "%" can go out: the rest is damaged or waiting for repair.', v_line.name using errcode = 'check_violation';
      end if;
      raise exception 'Only % of "%" available, and % were asked for.', v_line.qty_available, v_line.name, v_line.quantity
        using errcode = 'check_violation';
    end if;
    v_items := v_items || jsonb_build_object('item_id', v_line.item_id, 'name', v_line.name, 'quantity', v_line.quantity, 'unit', v_line.unit);
  end loop;

  v_ref := public.stores_next_reference('CO');
  insert into public.stores_checkouts (
    reference, request_id, employee_id, employee_name, department_id, department_name,
    checked_out_at, expected_return_date, notes, recorded_by, recorded_by_name
  ) values (
    v_ref, p_request_id, v_emp.id, v_emp.full_name, v_emp.department_id, v_emp.department_name,
    v_now, p_expected_return_date, public.stores_text(p_notes, 1000, 'The note'), auth.uid(), v_actor
  ) returning id into v_id;

  insert into public.stores_checkout_lines (checkout_id, item_id, item_name, unit, quantity)
  select v_id, l.item_id, i.name, i.unit, l.quantity
    from public.stores_item_lines(p_lines) l join public.stores_items i on i.id = l.item_id;

  update public.stores_items i
     set qty_available = i.qty_available - l.quantity,
         qty_checked_out = i.qty_checked_out + l.quantity
    from public.stores_item_lines(p_lines) l
   where i.id = l.item_id;

  insert into public.stores_movements (
    occurred_at, movement_type, reference, item_id, item_name, quantity,
    available_delta, checked_out_delta, employee_id, employee_name,
    department_id, department_name, checkout_id, recorded_by, recorded_by_name
  )
  select v_now, 'checked_out', v_ref, l.item_id, i.name, l.quantity,
         -l.quantity, l.quantity, v_emp.id, v_emp.full_name,
         v_emp.department_id, v_emp.department_name, v_id, auth.uid(), v_actor
    from public.stores_item_lines(p_lines) l join public.stores_items i on i.id = l.item_id;

  v_summary := jsonb_build_object(
    'reference', v_ref,
    'employee', v_emp.full_name,
    'department', v_emp.department_name,
    'items', v_items,
    'checked_out_at', v_now,
    'expected_return_date', p_expected_return_date
  );
  insert into public.stores_signatures (
    kind, checkout_id, employee_id, employee_name, drawing, acknowledgement,
    summary, summary_hash, signed_at, recorded_by, recorded_by_name
  ) values (
    'checkout', v_id, v_emp.id, v_emp.full_name, p_signature, v_ack,
    v_summary, encode(sha256(convert_to(v_summary::text || E'\n' || v_ack, 'UTF8')), 'hex'),
    v_now, auth.uid(), v_actor
  );

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$$;

-- ---------------------------------------------------------------------------
-- Check in: a whole or partial return, signed
-- ---------------------------------------------------------------------------

create or replace function public.stores_check_in(
  p_request_id uuid,
  p_checkout_id uuid,
  p_lines jsonb,
  p_signature jsonb,
  p_acknowledgement text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := public.stores_actor('stores.write');
  v_co public.stores_checkouts;
  v_id uuid;
  v_ref text;
  v_ack text;
  v_line jsonb;
  v_cl public.stores_checkout_lines;
  v_q int;
  v_cond text;
  v_note text;
  v_items jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_now timestamptz := now();
  v_dept_name text;
  v_left int;
begin
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  select r.id, r.reference into v_id, v_ref from public.stores_returns r where r.request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', true,
      'completed', (select status = 'completed' from public.stores_checkouts where id = p_checkout_id));
  end if;

  -- The checkout first, then its items: the same order every writer takes.
  select * into v_co from public.stores_checkouts where id = p_checkout_id for update;
  if not found then
    raise exception 'That checkout was not found.' using errcode = 'no_data_found';
  end if;
  if v_co.status <> 'open' then
    raise exception 'Checkout % has nothing outstanding.', v_co.reference using errcode = 'check_violation';
  end if;
  if not public.stores_signature_ok(p_signature) then
    raise exception 'The employee must sign before the return can be completed.' using errcode = 'check_violation';
  end if;
  v_ack := public.stores_acknowledgement('stores_return_acknowledgement', p_acknowledgement);
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Choose at least one item being returned.' using errcode = 'check_violation';
  end if;

  perform 1 from public.stores_items i
    where i.id in (select item_id from public.stores_checkout_lines where checkout_id = v_co.id)
    order by i.id for update;

  v_ref := public.stores_next_reference('RT');
  insert into public.stores_returns (
    reference, request_id, checkout_id, employee_id, employee_name, returned_at,
    notes, recorded_by, recorded_by_name
  ) values (
    v_ref, p_request_id, v_co.id, v_co.employee_id, v_co.employee_name, v_now,
    public.stores_text(p_notes, 1000, 'The note'), auth.uid(), v_actor
  ) returning id into v_id;

  select name into v_dept_name from public.stores_departments where id = v_co.department_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if (v_line ->> 'line_id') is null
       or (v_line ->> 'line_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'An item was not recognised.' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_line -> 'quantity') <> 'number'
       or (v_line ->> 'quantity')::numeric <> trunc((v_line ->> 'quantity')::numeric) then
      raise exception 'Every quantity must be a whole number.' using errcode = 'check_violation';
    end if;
    v_q := (v_line ->> 'quantity')::numeric::int;
    -- A line left at zero is an item not being returned today.
    continue when v_q = 0;
    if v_q < 0 then
      raise exception 'A quantity cannot be negative.' using errcode = 'check_violation';
    end if;
    v_cond := coalesce(v_line ->> 'condition', 'good');
    if v_cond not in ('good', 'damaged', 'missing_parts', 'needs_maintenance') then
      raise exception 'Choose the condition of each item.' using errcode = 'check_violation';
    end if;
    v_note := public.stores_text(v_line ->> 'note', 500, 'A note');

    select * into v_cl from public.stores_checkout_lines
     where id = (v_line ->> 'line_id')::uuid and checkout_id = v_co.id for update;
    if not found then
      raise exception 'An item is not part of checkout %.', v_co.reference using errcode = 'check_violation';
    end if;
    if v_q > v_cl.quantity_outstanding then
      raise exception 'Only % of "%" is outstanding, and % were entered as returned.', v_cl.quantity_outstanding, v_cl.item_name, v_q
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.stores_return_lines where return_id = v_id and checkout_line_id = v_cl.id) then
      raise exception '"%" is listed twice.', v_cl.item_name using errcode = 'check_violation';
    end if;

    insert into public.stores_return_lines (return_id, checkout_line_id, item_id, item_name, unit, quantity, condition, note)
    values (v_id, v_cl.id, v_cl.item_id, v_cl.item_name, v_cl.unit, v_q, v_cond, v_note);

    update public.stores_checkout_lines set quantity_returned = quantity_returned + v_q where id = v_cl.id;

    -- Good goes back on the shelf; anything else is held back until it is
    -- repaired or written off. Either way it is no longer on loan.
    update public.stores_items
       set qty_checked_out = qty_checked_out - v_q,
           qty_available = qty_available + case when v_cond = 'good' then v_q else 0 end,
           qty_unavailable = qty_unavailable + case when v_cond = 'good' then 0 else v_q end
     where id = v_cl.item_id;

    insert into public.stores_movements (
      occurred_at, movement_type, reference, item_id, item_name, quantity,
      available_delta, checked_out_delta, unavailable_delta, employee_id, employee_name,
      department_id, department_name, condition, notes, checkout_id, return_id,
      recorded_by, recorded_by_name
    ) values (
      v_now, 'returned', v_ref, v_cl.item_id, v_cl.item_name, v_q,
      case when v_cond = 'good' then v_q else 0 end, -v_q, case when v_cond = 'good' then 0 else v_q end,
      v_co.employee_id, v_co.employee_name, v_co.department_id, coalesce(v_co.department_name, v_dept_name),
      v_cond, v_note, v_co.id, v_id, auth.uid(), v_actor
    );

    v_items := v_items || jsonb_build_object('item_id', v_cl.item_id, 'name', v_cl.item_name, 'quantity', v_q, 'unit', v_cl.unit, 'condition', v_cond, 'note', v_note);
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'Enter how many of at least one item are being returned.' using errcode = 'check_violation';
  end if;

  select coalesce(sum(quantity_outstanding), 0) into v_left from public.stores_checkout_lines where checkout_id = v_co.id;
  if v_left = 0 then
    update public.stores_checkouts set status = 'completed', completed_at = v_now where id = v_co.id;
  end if;

  v_summary := jsonb_build_object(
    'reference', v_ref,
    'checkout_reference', v_co.reference,
    'employee', v_co.employee_name,
    'items', v_items,
    'returned_at', v_now,
    'outstanding_after', v_left
  );
  insert into public.stores_signatures (
    kind, checkout_id, return_id, employee_id, employee_name, drawing, acknowledgement,
    summary, summary_hash, signed_at, recorded_by, recorded_by_name
  ) values (
    'return', v_co.id, v_id, v_co.employee_id, v_co.employee_name, p_signature, v_ack,
    v_summary, encode(sha256(convert_to(v_summary::text || E'\n' || v_ack, 'UTF8')), 'hex'),
    v_now, auth.uid(), v_actor
  );

  return jsonb_build_object('id', v_id, 'reference', v_ref, 'completed', v_left = 0, 'outstanding', v_left);
end;
$$;

-- ---------------------------------------------------------------------------
-- Issue consumables
-- ---------------------------------------------------------------------------

create or replace function public.stores_issue(
  p_request_id uuid,
  p_employee_id uuid,
  p_lines jsonb,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := public.stores_actor('stores.write');
  v_emp record;
  v_id uuid;
  v_ref text;
  v_line record;
  v_now timestamptz := now();
  v_notes text := public.stores_text(p_notes, 1000, 'The note');
begin
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  select id, reference into v_id, v_ref from public.stores_issues where request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', true);
  end if;

  select e.id, e.full_name, e.is_active, e.department_id, d.name as department_name
    into v_emp
    from public.stores_employees e
    left join public.stores_departments d on d.id = e.department_id
   where e.id = p_employee_id;
  if not found then
    raise exception 'Choose the employee who is receiving the goods.' using errcode = 'check_violation';
  end if;
  if not v_emp.is_active then
    raise exception '% is no longer active in the directory.', v_emp.full_name using errcode = 'check_violation';
  end if;

  perform 1 from public.stores_items i
    where i.id in (select l.item_id from public.stores_item_lines(p_lines) l)
    order by i.id for update;

  for v_line in
    select l.item_id, l.quantity, i.name, i.unit, i.item_type, i.is_active, i.qty_available
      from public.stores_item_lines(p_lines) l left join public.stores_items i on i.id = l.item_id
     order by i.name
  loop
    if v_line.name is null then
      raise exception 'An item was not recognised.' using errcode = 'check_violation';
    end if;
    if not v_line.is_active then
      raise exception '"%" is switched off and cannot be issued.', v_line.name using errcode = 'check_violation';
    end if;
    if v_line.item_type <> 'consumable' then
      raise exception '"%" is not a consumable. Check equipment out, or assign an asset, instead.', v_line.name using errcode = 'check_violation';
    end if;
    if v_line.quantity > v_line.qty_available then
      raise exception 'Only % % of "%" in stock, and % were asked for.', v_line.qty_available, v_line.unit, v_line.name, v_line.quantity
        using errcode = 'check_violation';
    end if;
  end loop;

  v_ref := public.stores_next_reference('IS');
  insert into public.stores_issues (
    reference, request_id, employee_id, employee_name, department_id, department_name,
    issued_at, notes, recorded_by, recorded_by_name
  ) values (
    v_ref, p_request_id, v_emp.id, v_emp.full_name, v_emp.department_id, v_emp.department_name,
    v_now, v_notes, auth.uid(), v_actor
  ) returning id into v_id;

  insert into public.stores_issue_lines (issue_id, item_id, item_name, unit, quantity)
  select v_id, l.item_id, i.name, i.unit, l.quantity
    from public.stores_item_lines(p_lines) l join public.stores_items i on i.id = l.item_id;

  update public.stores_items i
     set qty_available = i.qty_available - l.quantity
    from public.stores_item_lines(p_lines) l
   where i.id = l.item_id;

  insert into public.stores_movements (
    occurred_at, movement_type, reference, item_id, item_name, quantity, available_delta,
    employee_id, employee_name, department_id, department_name, notes, issue_id,
    recorded_by, recorded_by_name
  )
  select v_now, 'issued', v_ref, l.item_id, i.name, l.quantity, -l.quantity,
         v_emp.id, v_emp.full_name, v_emp.department_id, v_emp.department_name, v_notes, v_id,
         auth.uid(), v_actor
    from public.stores_item_lines(p_lines) l join public.stores_items i on i.id = l.item_id;

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$$;

-- ---------------------------------------------------------------------------
-- Assign an asset for good, and bring one back
-- ---------------------------------------------------------------------------

create or replace function public.stores_assign(
  p_request_id uuid,
  p_item_id uuid,
  p_quantity int,
  p_department_id uuid default null,
  p_employee_id uuid default null,
  p_location_note text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := public.stores_actor('stores.write');
  v_item public.stores_items;
  v_emp record;
  v_dept record;
  v_id uuid;
  v_ref text;
  v_now timestamptz := now();
  v_notes text := public.stores_text(p_notes, 1000, 'The note');
begin
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  select id, reference into v_id, v_ref from public.stores_assignments where request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', true);
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'The quantity must be a whole number greater than zero.' using errcode = 'check_violation';
  end if;

  if p_employee_id is not null then
    select e.id, e.full_name, e.is_active, e.department_id into v_emp from public.stores_employees e where e.id = p_employee_id;
    if not found then
      raise exception 'That employee is not in the directory.' using errcode = 'check_violation';
    end if;
    if not v_emp.is_active then
      raise exception '% is no longer active in the directory.', v_emp.full_name using errcode = 'check_violation';
    end if;
  end if;

  -- Always a department: the one chosen, else the responsible person's.
  select id, name, is_active into v_dept from public.stores_departments
   where id = coalesce(p_department_id, case when p_employee_id is not null then v_emp.department_id end);
  if not found then
    raise exception 'Choose the department the item is assigned to.' using errcode = 'check_violation';
  end if;
  if not v_dept.is_active then
    raise exception 'The % department is no longer in use.', v_dept.name using errcode = 'check_violation';
  end if;

  select * into v_item from public.stores_items where id = p_item_id for update;
  if not found then
    raise exception 'That item is not on the register.' using errcode = 'no_data_found';
  end if;
  if not v_item.is_active then
    raise exception '"%" is switched off and cannot be assigned.', v_item.name using errcode = 'check_violation';
  end if;
  if v_item.item_type = 'consumable' then
    raise exception '"%" is a consumable. Issue it from Stock Issues instead.', v_item.name using errcode = 'check_violation';
  end if;
  if p_quantity > v_item.qty_available then
    raise exception 'Only % of "%" available, and % were asked for.', v_item.qty_available, v_item.name, p_quantity
      using errcode = 'check_violation';
  end if;

  v_ref := public.stores_next_reference('AS');
  insert into public.stores_assignments (
    reference, request_id, item_id, item_name, unit, quantity, department_id, department_name,
    employee_id, employee_name, location_note, assigned_at, notes, recorded_by, recorded_by_name
  ) values (
    v_ref, p_request_id, v_item.id, v_item.name, v_item.unit, p_quantity, v_dept.id, v_dept.name,
    p_employee_id, case when p_employee_id is not null then v_emp.full_name end,
    public.stores_text(p_location_note, 160, 'The location'), v_now, v_notes, auth.uid(), v_actor
  ) returning id into v_id;

  update public.stores_items
     set qty_available = qty_available - p_quantity,
         qty_assigned = qty_assigned + p_quantity
   where id = v_item.id;

  insert into public.stores_movements (
    occurred_at, movement_type, reference, item_id, item_name, quantity,
    available_delta, assigned_delta, employee_id, employee_name, department_id, department_name,
    notes, assignment_id, recorded_by, recorded_by_name
  ) values (
    v_now, 'assigned', v_ref, v_item.id, v_item.name, p_quantity,
    -p_quantity, p_quantity, p_employee_id, case when p_employee_id is not null then v_emp.full_name end,
    v_dept.id, v_dept.name, v_notes, v_id, auth.uid(), v_actor
  );

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$$;

create or replace function public.stores_return_asset(
  p_request_id uuid,
  p_assignment_id uuid,
  p_quantity int,
  p_condition text default 'good',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := public.stores_actor('stores.write');
  v_as public.stores_assignments;
  v_id uuid;
  v_ref text;
  v_cond text := coalesce(p_condition, 'good');
  v_now timestamptz := now();
  v_notes text := public.stores_text(p_notes, 1000, 'The note');
begin
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  select id, reference into v_id, v_ref from public.stores_asset_returns where request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', true);
  end if;
  if v_cond not in ('good', 'damaged', 'missing_parts', 'needs_maintenance') then
    raise exception 'Choose the condition of the item.' using errcode = 'check_violation';
  end if;

  select * into v_as from public.stores_assignments where id = p_assignment_id for update;
  if not found then
    raise exception 'That assignment was not found.' using errcode = 'no_data_found';
  end if;
  if v_as.status <> 'active' then
    raise exception 'Assignment % is no longer active.', v_as.reference using errcode = 'check_violation';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > v_as.quantity_held then
    raise exception 'Enter between 1 and % for "%".', v_as.quantity_held, v_as.item_name using errcode = 'check_violation';
  end if;
  perform 1 from public.stores_items where id = v_as.item_id for update;

  v_ref := public.stores_next_reference('AR');
  insert into public.stores_asset_returns (
    reference, request_id, assignment_id, item_id, item_name, quantity, condition, notes,
    returned_at, recorded_by, recorded_by_name
  ) values (
    v_ref, p_request_id, v_as.id, v_as.item_id, v_as.item_name, p_quantity, v_cond, v_notes,
    v_now, auth.uid(), v_actor
  ) returning id into v_id;

  update public.stores_assignments
     set quantity_returned = quantity_returned + p_quantity,
         status = case when quantity_returned + p_quantity = quantity then 'returned' else status end,
         returned_at = case when quantity_returned + p_quantity = quantity then v_now else returned_at end
   where id = v_as.id;

  update public.stores_items
     set qty_assigned = qty_assigned - p_quantity,
         qty_available = qty_available + case when v_cond = 'good' then p_quantity else 0 end,
         qty_unavailable = qty_unavailable + case when v_cond = 'good' then 0 else p_quantity end
   where id = v_as.item_id;

  insert into public.stores_movements (
    occurred_at, movement_type, reference, item_id, item_name, quantity,
    available_delta, assigned_delta, unavailable_delta, employee_id, employee_name,
    department_id, department_name, condition, notes, assignment_id, asset_return_id,
    recorded_by, recorded_by_name
  ) values (
    v_now, 'asset_returned', v_ref, v_as.item_id, v_as.item_name, p_quantity,
    case when v_cond = 'good' then p_quantity else 0 end, -p_quantity, case when v_cond = 'good' then 0 else p_quantity end,
    v_as.employee_id, v_as.employee_name, v_as.department_id, v_as.department_name,
    v_cond, v_notes, v_as.id, v_id, auth.uid(), v_actor
  );

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$$;

-- ---------------------------------------------------------------------------
-- Adjust: the documented corrections
-- ---------------------------------------------------------------------------

-- `p_quantity` is signed for a count correction (more or fewer found on the
-- shelf) and a positive count for everything else.
create or replace function public.stores_adjust(
  p_request_id uuid,
  p_item_id uuid,
  p_kind text,
  p_quantity int,
  p_reason text,
  p_checkout_line_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text;
  v_item public.stores_items;
  v_cl public.stores_checkout_lines;
  v_co public.stores_checkouts;
  v_id uuid;
  v_ref text;
  v_reason text := public.stores_text(p_reason, 500, 'The reason');
  v_q int;
  v_da int := 0;
  v_dco int := 0;
  v_du int := 0;
  v_now timestamptz := now();
begin
  -- Damage found on the shelf, and a repair, are the storekeeper's to
  -- record. A count correction and anything that makes stock disappear are
  -- an administrator's, with a reason.
  if p_kind in ('mark_damaged', 'repaired') then
    v_actor := public.stores_actor('stores.write');
  elsif p_kind in ('count_correction', 'write_off', 'write_off_outstanding') then
    v_actor := public.stores_actor('stores.admin');
  else
    raise exception 'That is not a kind of adjustment.' using errcode = 'check_violation';
  end if;
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  select id, reference into v_id, v_ref from public.stores_adjustments where request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', true);
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'Say why, in a few words.' using errcode = 'check_violation';
  end if;
  if p_quantity is null or p_quantity = 0 or abs(p_quantity) > 1000000 then
    raise exception 'Enter a quantity.' using errcode = 'check_violation';
  end if;
  if p_kind <> 'count_correction' and p_quantity < 0 then
    raise exception 'Enter a positive quantity.' using errcode = 'check_violation';
  end if;
  v_q := abs(p_quantity);

  if p_kind = 'write_off_outstanding' then
    select * into v_cl from public.stores_checkout_lines where id = p_checkout_line_id;
    if not found then
      raise exception 'That checkout line was not found.' using errcode = 'no_data_found';
    end if;
    select * into v_co from public.stores_checkouts where id = v_cl.checkout_id for update;
    select * into v_cl from public.stores_checkout_lines where id = p_checkout_line_id for update;
    if p_item_id is distinct from v_cl.item_id then
      raise exception 'That checkout line is for a different item.' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_item from public.stores_items where id = p_item_id for update;
  if not found then
    raise exception 'That item is not on the register.' using errcode = 'no_data_found';
  end if;

  case p_kind
    when 'count_correction' then
      if v_item.qty_available + p_quantity < 0 then
        raise exception 'Only % of "%" is on the shelf, so the count cannot fall by %.', v_item.qty_available, v_item.name, v_q
          using errcode = 'check_violation';
      end if;
      v_da := p_quantity;
    when 'mark_damaged' then
      if v_item.item_type = 'consumable' then
        raise exception 'A damaged consumable is a count correction: ask a Stores administrator.' using errcode = 'check_violation';
      end if;
      if v_q > v_item.qty_available then
        raise exception 'Only % of "%" is on the shelf.', v_item.qty_available, v_item.name using errcode = 'check_violation';
      end if;
      v_da := -v_q;
      v_du := v_q;
    when 'repaired' then
      if v_q > v_item.qty_unavailable then
        raise exception 'Only % of "%" is held back as damaged or awaiting repair.', v_item.qty_unavailable, v_item.name
          using errcode = 'check_violation';
      end if;
      v_da := v_q;
      v_du := -v_q;
    when 'write_off' then
      if v_q > v_item.qty_unavailable then
        raise exception 'Only % of "%" is held back as damaged or awaiting repair.', v_item.qty_unavailable, v_item.name
          using errcode = 'check_violation';
      end if;
      v_du := -v_q;
    when 'write_off_outstanding' then
      if v_q > v_cl.quantity_outstanding then
        raise exception 'Only % of "%" is outstanding on %.', v_cl.quantity_outstanding, v_cl.item_name, v_co.reference
          using errcode = 'check_violation';
      end if;
      v_dco := -v_q;
  end case;

  v_ref := public.stores_next_reference('AD');
  insert into public.stores_adjustments (
    reference, request_id, item_id, item_name, kind, quantity, available_delta,
    checked_out_delta, unavailable_delta, checkout_line_id, reason, recorded_at,
    recorded_by, recorded_by_name
  ) values (
    v_ref, p_request_id, v_item.id, v_item.name, p_kind, v_q, v_da, v_dco, v_du,
    case when p_kind = 'write_off_outstanding' then v_cl.id end, v_reason, v_now, auth.uid(), v_actor
  ) returning id into v_id;

  update public.stores_items
     set qty_available = qty_available + v_da,
         qty_checked_out = qty_checked_out + v_dco,
         qty_unavailable = qty_unavailable + v_du
   where id = v_item.id;

  if p_kind = 'write_off_outstanding' then
    update public.stores_checkout_lines set quantity_written_off = quantity_written_off + v_q where id = v_cl.id;
    if (select coalesce(sum(quantity_outstanding), 0) from public.stores_checkout_lines where checkout_id = v_co.id) = 0 then
      update public.stores_checkouts set status = 'completed', completed_at = v_now where id = v_co.id;
    end if;
  end if;

  insert into public.stores_movements (
    occurred_at, movement_type, reference, item_id, item_name, quantity,
    available_delta, checked_out_delta, unavailable_delta,
    employee_id, employee_name, department_id, department_name,
    notes, checkout_id, adjustment_id, recorded_by, recorded_by_name
  ) values (
    v_now, 'adjustment', v_ref, v_item.id, v_item.name, v_q,
    v_da, v_dco, v_du,
    case when p_kind = 'write_off_outstanding' then v_co.employee_id end,
    case when p_kind = 'write_off_outstanding' then v_co.employee_name end,
    case when p_kind = 'write_off_outstanding' then v_co.department_id end,
    case when p_kind = 'write_off_outstanding' then v_co.department_name end,
    v_reason, case when p_kind = 'write_off_outstanding' then v_co.id end, v_id, auth.uid(), v_actor
  );

  return jsonb_build_object('id', v_id, 'reference', v_ref);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reverse: a documented undo, by an administrator
-- ---------------------------------------------------------------------------

create or replace function public.stores_reverse(
  p_request_id uuid,
  p_kind text,
  p_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := public.stores_actor('stores.admin');
  v_reason text := public.stores_text(p_reason, 500, 'The reason');
  v_id uuid;
  v_ref text;
  v_target_ref text;
  v_reversed uuid;
  v_checkout uuid;
  v_status text;
  v_m public.stores_movements;
  v_item public.stores_items;
  v_now timestamptz := now();
begin
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  select id, reference into v_id, v_ref from public.stores_reversals where request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', true);
  end if;
  if v_reason is null or length(v_reason) < 3 then
    raise exception 'Say why this is being reversed.' using errcode = 'check_violation';
  end if;

  -- Lock the target, and check it may be reversed.
  case p_kind
    when 'receipt' then
      select reference, reversal_id into v_target_ref, v_reversed from public.stores_receipts where id = p_id for update;
      if found and (select quantity from public.stores_receipts where id = p_id) = 0 then
        raise exception '% moved no stock, so there is nothing to reverse.', v_target_ref using errcode = 'check_violation';
      end if;
    when 'checkout' then
      select reference, reversal_id, status into v_target_ref, v_reversed, v_status from public.stores_checkouts where id = p_id for update;
      if found and exists (
        select 1 from public.stores_checkout_lines where checkout_id = p_id and (quantity_returned > 0 or quantity_written_off > 0)
      ) then
        raise exception 'Some of checkout % has already come back or been written off. Reverse those first.', v_target_ref
          using errcode = 'check_violation';
      end if;
    when 'return' then
      select r.reference, r.reversal_id, r.checkout_id into v_target_ref, v_reversed, v_checkout
        from public.stores_returns r where r.id = p_id for update;
      if found then
        perform 1 from public.stores_checkouts where id = v_checkout for update;
        -- Only the latest return of a checkout, so the lines go back to a
        -- state that actually existed.
        if exists (
          select 1 from public.stores_returns r2
           where r2.checkout_id = v_checkout and r2.reversal_id is null and r2.returned_at > (select returned_at from public.stores_returns where id = p_id)
        ) then
          raise exception 'A later return was recorded on the same checkout. Reverse that one first.' using errcode = 'check_violation';
        end if;
      end if;
    when 'issue' then
      select reference, reversal_id into v_target_ref, v_reversed from public.stores_issues where id = p_id for update;
    when 'assignment' then
      select reference, reversal_id, status into v_target_ref, v_reversed, v_status from public.stores_assignments where id = p_id for update;
      if found and exists (select 1 from public.stores_asset_returns where assignment_id = p_id) then
        raise exception 'Some of assignment % has already come back to the storeroom. Record an adjustment instead.', v_target_ref
          using errcode = 'check_violation';
      end if;
    else
      raise exception 'That kind of transaction cannot be reversed.' using errcode = 'check_violation';
  end case;
  if v_target_ref is null then
    raise exception 'That transaction was not found.' using errcode = 'no_data_found';
  end if;
  if v_reversed is not null then
    raise exception '% has already been reversed.', v_target_ref using errcode = 'check_violation';
  end if;

  v_ref := public.stores_next_reference('RV');
  insert into public.stores_reversals (reference, request_id, target_kind, target_id, target_reference, reason, recorded_at, recorded_by, recorded_by_name)
  values (v_ref, p_request_id, p_kind, p_id, v_target_ref, v_reason, v_now, auth.uid(), v_actor)
  returning id into v_id;

  -- Undo every line the transaction moved, exactly, in item order.
  perform 1 from public.stores_items i
   where i.id in (
     select m.item_id from public.stores_movements m
      where m.movement_type <> 'reversal'
        and case p_kind
              when 'receipt' then m.receipt_id = p_id
              when 'checkout' then m.checkout_id = p_id and m.movement_type = 'checked_out'
              when 'return' then m.return_id = p_id
              when 'issue' then m.issue_id = p_id
              when 'assignment' then m.assignment_id = p_id and m.movement_type = 'assigned'
            end)
   order by i.id for update;

  for v_m in
    select * from public.stores_movements m
     where m.movement_type <> 'reversal'
       and case p_kind
             when 'receipt' then m.receipt_id = p_id
             when 'checkout' then m.checkout_id = p_id and m.movement_type = 'checked_out'
             when 'return' then m.return_id = p_id
             when 'issue' then m.issue_id = p_id
             when 'assignment' then m.assignment_id = p_id and m.movement_type = 'assigned'
           end
     order by m.id
  loop
    select * into v_item from public.stores_items where id = v_m.item_id;
    if v_item.qty_available - v_m.available_delta < 0
       or v_item.qty_checked_out - v_m.checked_out_delta < 0
       or v_item.qty_assigned - v_m.assigned_delta < 0
       or v_item.qty_unavailable - v_m.unavailable_delta < 0 then
      raise exception 'This cannot be reversed: some of the "%" it moved has moved again since. Record an adjustment instead.', v_m.item_name
        using errcode = 'check_violation';
    end if;
    update public.stores_items
       set qty_available = qty_available - v_m.available_delta,
           qty_checked_out = qty_checked_out - v_m.checked_out_delta,
           qty_assigned = qty_assigned - v_m.assigned_delta,
           qty_unavailable = qty_unavailable - v_m.unavailable_delta
     where id = v_m.item_id;
    insert into public.stores_movements (
      occurred_at, movement_type, reference, item_id, item_name, quantity,
      available_delta, checked_out_delta, assigned_delta, unavailable_delta,
      employee_id, employee_name, department_id, department_name, condition, notes,
      receipt_id, checkout_id, return_id, issue_id, assignment_id, reversal_id,
      reverses_movement_id, recorded_by, recorded_by_name
    ) values (
      v_now, 'reversal', v_ref, v_m.item_id, v_m.item_name, v_m.quantity,
      -v_m.available_delta, -v_m.checked_out_delta, -v_m.assigned_delta, -v_m.unavailable_delta,
      v_m.employee_id, v_m.employee_name, v_m.department_id, v_m.department_name, v_m.condition,
      'Reverses ' || v_target_ref || ': ' || v_reason,
      v_m.receipt_id, v_m.checkout_id, v_m.return_id, v_m.issue_id, v_m.assignment_id, v_id,
      v_m.id, auth.uid(), v_actor
    );
  end loop;

  -- Mark the target, and put the lines it touched back as they were.
  case p_kind
    when 'receipt' then
      update public.stores_receipts set reversal_id = v_id where id = p_id;
    when 'checkout' then
      update public.stores_checkouts set reversal_id = v_id, status = 'reversed', completed_at = v_now where id = p_id;
    when 'return' then
      update public.stores_returns set reversal_id = v_id where id = p_id;
      update public.stores_checkout_lines cl
         set quantity_returned = cl.quantity_returned - rl.quantity
        from public.stores_return_lines rl
       where rl.return_id = p_id and rl.checkout_line_id = cl.id;
      update public.stores_checkouts set status = 'open', completed_at = null where id = v_checkout;
    when 'issue' then
      update public.stores_issues set reversal_id = v_id where id = p_id;
    when 'assignment' then
      update public.stores_assignments set reversal_id = v_id, status = 'reversed', returned_at = v_now where id = p_id;
  end case;

  return jsonb_build_object('id', v_id, 'reference', v_ref, 'target_reference', v_target_ref);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------

-- Each checks `stores.write` or `stores.admin` itself, first. Callable by a
-- signed-in member of staff and by nobody else.
revoke all on function public.stores_create_item(uuid, text, uuid, text, text, text, int, uuid, bigint, text, int) from public, anon;
revoke all on function public.stores_receive(uuid, uuid, int, date, text, bigint, text, text) from public, anon;
revoke all on function public.stores_checkout(uuid, uuid, date, jsonb, jsonb, text, text) from public, anon;
revoke all on function public.stores_check_in(uuid, uuid, jsonb, jsonb, text, text) from public, anon;
revoke all on function public.stores_issue(uuid, uuid, jsonb, text) from public, anon;
revoke all on function public.stores_assign(uuid, uuid, int, uuid, uuid, text, text) from public, anon;
revoke all on function public.stores_return_asset(uuid, uuid, int, text, text) from public, anon;
revoke all on function public.stores_adjust(uuid, uuid, text, int, text, uuid) from public, anon;
revoke all on function public.stores_reverse(uuid, text, uuid, text) from public, anon;

grant execute on function public.stores_create_item(uuid, text, uuid, text, text, text, int, uuid, bigint, text, int) to authenticated;
grant execute on function public.stores_receive(uuid, uuid, int, date, text, bigint, text, text) to authenticated;
grant execute on function public.stores_checkout(uuid, uuid, date, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.stores_check_in(uuid, uuid, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.stores_issue(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.stores_assign(uuid, uuid, int, uuid, uuid, text, text) to authenticated;
grant execute on function public.stores_return_asset(uuid, uuid, int, text, text) to authenticated;
grant execute on function public.stores_adjust(uuid, uuid, text, int, text, uuid) to authenticated;
grant execute on function public.stores_reverse(uuid, text, uuid, text) to authenticated;
