-- Hibiscus Stores: what the screens read, the proof that the balances are
-- right, the audit trail of settings edits, and who may hand out the two
-- Stores roles.

-- ---------------------------------------------------------------------------
-- Equipment out on loan, one row per item per checkout
-- ---------------------------------------------------------------------------

-- Overdue is computed, never stored: an item is overdue when its return date
-- is before today in Gaborone and some of it has not come back. A stored flag
-- would need a job to set it, and would be wrong for as long as the job had
-- not run.
create or replace view public.v_stores_outstanding
with (security_invoker = true)
as
select
  cl.id as line_id,
  c.id as checkout_id,
  c.reference,
  c.employee_id,
  c.employee_name,
  c.department_id,
  c.department_name,
  cl.item_id,
  cl.item_name,
  cl.unit,
  cl.quantity,
  cl.quantity_returned,
  cl.quantity_written_off,
  cl.quantity_outstanding,
  c.checked_out_at,
  c.expected_return_date,
  c.expected_return_date < public.stores_today() as is_overdue,
  (public.stores_today() - c.expected_return_date) as days_overdue
from public.stores_checkout_lines cl
join public.stores_checkouts c on c.id = cl.checkout_id
where c.status = 'open'
  and cl.quantity_outstanding > 0;

-- ---------------------------------------------------------------------------
-- The ledger with what a filter needs: the item's category and type
-- ---------------------------------------------------------------------------

create or replace view public.v_stores_movements
with (security_invoker = true)
as
select
  m.id,
  m.occurred_at,
  m.movement_type,
  m.reference,
  m.item_id,
  m.item_name,
  i.item_type,
  i.unit,
  i.category_id,
  cat.name as category_name,
  m.quantity,
  m.available_delta,
  m.checked_out_delta,
  m.assigned_delta,
  m.unavailable_delta,
  m.employee_id,
  m.employee_name,
  m.department_id,
  m.department_name,
  m.condition,
  m.notes,
  m.receipt_id,
  m.checkout_id,
  m.return_id,
  m.issue_id,
  m.assignment_id,
  m.asset_return_id,
  m.adjustment_id,
  m.reversal_id,
  m.reverses_movement_id,
  m.recorded_by,
  m.recorded_by_name
from public.stores_movements m
join public.stores_items i on i.id = m.item_id
left join public.stores_categories cat on cat.id = i.category_id;

-- ---------------------------------------------------------------------------
-- The dashboard, in one round trip
-- ---------------------------------------------------------------------------

-- Security invoker: a person without stores.read reads zeros, not the
-- storeroom.
create or replace function public.stores_dashboard_counts()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with soon as (
    select coalesce((select (value #>> '{}')::int from public.settings where key = 'stores_due_soon_days'), 2) as days
  )
  select jsonb_build_object(
    'total_items', (select count(*) from public.stores_items where is_active),
    'available_equipment', (select coalesce(sum(qty_available), 0) from public.stores_items where is_active and item_type = 'reusable'),
    'checked_out', (select coalesce(sum(qty_checked_out), 0) from public.stores_items),
    'open_checkouts', (select count(*) from public.stores_checkouts where status = 'open'),
    'overdue_quantity', (select coalesce(sum(quantity_outstanding), 0) from public.v_stores_outstanding where is_overdue),
    'overdue_checkouts', (select count(distinct checkout_id) from public.v_stores_outstanding where is_overdue),
    'due_soon_quantity', (
      select coalesce(sum(o.quantity_outstanding), 0) from public.v_stores_outstanding o, soon
       where not o.is_overdue and o.expected_return_date <= public.stores_today() + soon.days
    ),
    'low_stock', (select count(*) from public.stores_items where is_active and is_low_stock),
    -- The register's own "Out of Stock": nothing on the shelf, and not
    -- simply because every one of them is out on loan or assigned.
    'out_of_stock', (
      select count(*) from public.stores_items
       where is_active and qty_available = 0
         and not (qty_unavailable = 0 and qty_checked_out + qty_assigned > 0)
    ),
    'assigned', (select coalesce(sum(qty_assigned), 0) from public.stores_items),
    'unavailable', (select coalesce(sum(qty_unavailable), 0) from public.stores_items),
    'due_soon_days', (select days from soon)
  )
$$;

revoke execute on function public.stores_dashboard_counts() from public, anon;
grant execute on function public.stores_dashboard_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- Reconciliation: every balance against its history
-- ---------------------------------------------------------------------------

-- No rows means the storeroom reconciles. Three questions per item:
--
--   do the four balances equal the sum of every movement's change to them;
--   does "on loan" equal what the open checkouts say is outstanding;
--   does "assigned" equal what the active assignments say is held.
--
-- The functions keep all three true in one transaction each; this is how
-- anybody can see that they did, and the security suite runs it.
create or replace function public.stores_reconciliation()
returns table (item_id uuid, item_name text, problem text)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ledger as (
    select m.item_id,
           sum(m.available_delta) as available,
           sum(m.checked_out_delta) as checked_out,
           sum(m.assigned_delta) as assigned,
           sum(m.unavailable_delta) as unavailable
      from public.stores_movements m
     group by m.item_id
  ),
  loans as (
    select cl.item_id, sum(cl.quantity_outstanding) as outstanding
      from public.stores_checkout_lines cl
      join public.stores_checkouts c on c.id = cl.checkout_id
     where c.status = 'open'
     group by cl.item_id
  ),
  held as (
    select a.item_id, sum(a.quantity_held) as held
      from public.stores_assignments a
     where a.status = 'active'
     group by a.item_id
  )
  select i.id, i.name,
         format('balances %s/%s/%s/%s, history %s/%s/%s/%s (available/on loan/assigned/held back)',
                i.qty_available, i.qty_checked_out, i.qty_assigned, i.qty_unavailable,
                coalesce(l.available, 0), coalesce(l.checked_out, 0), coalesce(l.assigned, 0), coalesce(l.unavailable, 0))
    from public.stores_items i
    left join ledger l on l.item_id = i.id
   where i.qty_available <> coalesce(l.available, 0)
      or i.qty_checked_out <> coalesce(l.checked_out, 0)
      or i.qty_assigned <> coalesce(l.assigned, 0)
      or i.qty_unavailable <> coalesce(l.unavailable, 0)
  union all
  select i.id, i.name, format('on loan %s, open checkouts say %s', i.qty_checked_out, coalesce(o.outstanding, 0))
    from public.stores_items i left join loans o on o.item_id = i.id
   where i.qty_checked_out <> coalesce(o.outstanding, 0)
  union all
  select i.id, i.name, format('assigned %s, active assignments say %s', i.qty_assigned, coalesce(h.held, 0))
    from public.stores_items i left join held h on h.item_id = i.id
   where i.qty_assigned <> coalesce(h.held, 0)
$$;

revoke execute on function public.stores_reconciliation() from public, anon;
grant execute on function public.stores_reconciliation() to authenticated;

-- ---------------------------------------------------------------------------
-- Consumables used, by item and department, over a period
-- ---------------------------------------------------------------------------

-- Counted against the day the goods were issued, not the day a line was
-- written: a reversal is dated when somebody noticed the mistake, which may
-- be next month, and charging the minus to next month would leave this
-- month's figure wrong and next month's negative. A reversed issue's lines
-- carry the issue's id too, with the opposite sign, so a reversed issue nets
-- to nothing in its own period, and it is not counted as an issue.
create or replace function public.stores_consumables_usage(p_from date, p_to date)
returns table (item_id uuid, item_name text, unit text, category_name text, department_name text, quantity bigint, issues bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select m.item_id,
         i.name,
         i.unit,
         c.name,
         coalesce(s.department_name, 'No department'),
         sum(-m.available_delta)::bigint,
         count(distinct s.id) filter (where s.reversal_id is null)::bigint
    from public.stores_movements m
    join public.stores_issues s on s.id = m.issue_id
    join public.stores_items i on i.id = m.item_id
    left join public.stores_categories c on c.id = i.category_id
   where (s.issued_at at time zone 'Africa/Gaborone')::date between p_from and p_to
   group by m.item_id, i.name, i.unit, c.name, coalesce(s.department_name, 'No department')
  having sum(-m.available_delta) <> 0
   order by i.name, 5
$$;

revoke execute on function public.stores_consumables_usage(date, date) from public, anon;
grant execute on function public.stores_consumables_usage(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Who changed an item, an employee or a setting
-- ---------------------------------------------------------------------------

-- The settings tables and the directory are edited straight through the API
-- under row-level security, so the audit line is written here rather than
-- by the server action: nothing that reaches the table can skip it. A change
-- to an item's balances alone is not logged here, because the movement it
-- belongs to already says who, what and why.
create or replace function public.stores_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_skip text[] := array['updated_at', 'updated_by', 'qty_available', 'qty_checked_out', 'qty_assigned', 'qty_unavailable', 'qty_total', 'is_low_stock'];
  v_before jsonb;
  v_after jsonb := to_jsonb(new) - v_skip;
  v_label text;
begin
  if tg_op = 'UPDATE' then
    v_before := to_jsonb(old) - v_skip;
    if v_before = v_after then
      return null;
    end if;
  end if;
  select email into v_label from public.staff_profiles where id = auth.uid();
  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, before, after)
  values (
    case when auth.uid() is null then 'system' else 'staff' end,
    auth.uid(),
    v_label,
    tg_table_name || case tg_op when 'INSERT' then '.created' else '.updated' end,
    tg_table_name,
    new.id,
    v_before,
    v_after
  );
  return null;
end;
$$;

revoke all on function public.stores_audit() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['stores_items', 'stores_employees', 'stores_departments', 'stores_categories', 'stores_locations'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.stores_audit()', t || '_audit', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- A Stores administrator hands out the two Stores roles, and nothing else
-- ---------------------------------------------------------------------------

-- `staff.write` is the platform's own power over people: inviting, roles at
-- every school, switching sign-ins off. A Stores administrator must be able
-- to give the storekeeper their access without holding that, so this one
-- function does exactly one thing: add or remove `storekeeper` or
-- `stores_admin` for an existing account. The same three rules as
-- `staff_roles`' own policies apply:
--
--   1. not on your own account, unless you may edit the matrix;
--   2. not a role carrying a permission you do not hold (`can_grant_role`);
--   3. nothing but the two Stores roles.
create or replace function public.stores_set_role(p_staff_id uuid, p_role_code text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor text := public.stores_actor('stores.admin');
  v_role uuid;
  v_label text;
begin
  if p_role_code is null or p_role_code not in ('storekeeper', 'stores_admin') then
    raise exception 'Only the Stores roles can be changed here.' using errcode = 'insufficient_privilege';
  end if;
  if p_staff_id = auth.uid() and not public.has_permission('roles.write') then
    raise exception 'You cannot change your own roles. Ask a super administrator.' using errcode = 'insufficient_privilege';
  end if;
  select id into v_role from public.roles where code = p_role_code;
  if v_role is null or not public.can_grant_role(v_role) then
    raise exception 'You cannot give or take away that role.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.staff_profiles where id = p_staff_id) then
    raise exception 'That account was not found.' using errcode = 'no_data_found';
  end if;

  if p_granted then
    insert into public.staff_roles (staff_id, role_id) values (p_staff_id, v_role) on conflict do nothing;
  else
    delete from public.staff_roles where staff_id = p_staff_id and role_id = v_role;
  end if;

  select email into v_label from public.staff_profiles where id = auth.uid();
  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, after)
  values ('staff', auth.uid(), v_label, case when p_granted then 'stores.role_granted' else 'stores.role_removed' end,
          'staff_profile', p_staff_id, jsonb_build_object('role', p_role_code, 'by', v_actor));
end;
$$;

revoke all on function public.stores_set_role(uuid, text, boolean) from public, anon;
grant execute on function public.stores_set_role(uuid, text, boolean) to authenticated;
