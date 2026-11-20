-- Hibiscus Stores: the second part of `stores_ledger`, as production ran it.
--
-- `20261120145940_stores_ledger.sql` was too large for one call of the
-- Supabase connector, so on 20 November 2026 it was applied to production in
-- three parts, and production recorded a version for each. This file is the
-- second part, word for word: the checkout, check-in, issue, assignment and
-- asset-return functions. The ledger file before it already holds the same
-- SQL in full, so on a fresh database this runs it a second time; every
-- statement is `create or replace`, so the result is the same.

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
  -- Two arrivals of the same request (a retry while the first is still
  -- running) queue here, so the second sees the first's row and replays it
  -- instead of failing on the unique index.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
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
  -- Two arrivals of the same request (a retry while the first is still
  -- running) queue here, so the second sees the first's row and replays it
  -- instead of failing on the unique index.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
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
  -- Two arrivals of the same request (a retry while the first is still
  -- running) queue here, so the second sees the first's row and replays it
  -- instead of failing on the unique index.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
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
  -- Scalars rather than a record: a record that is never assigned (no
  -- responsible person) cannot have its fields named in a statement at all,
  -- even in a branch that is not taken, and the department-only
  -- assignment failed with "record v_emp is not assigned yet".
  v_emp_name text;
  v_emp_department uuid;
  v_emp_active boolean;
  v_dept public.stores_departments;
  v_id uuid;
  v_ref text;
  v_now timestamptz := now();
  v_notes text := public.stores_text(p_notes, 1000, 'The note');
begin
  if p_request_id is null then
    raise exception 'The request has no id. Reload the page and try again.' using errcode = 'check_violation';
  end if;
  -- Two arrivals of the same request (a retry while the first is still
  -- running) queue here, so the second sees the first's row and replays it
  -- instead of failing on the unique index.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select id, reference into v_id, v_ref from public.stores_assignments where request_id = p_request_id;
  if found then
    return jsonb_build_object('id', v_id, 'reference', v_ref, 'replayed', true);
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100000 then
    raise exception 'The quantity must be a whole number greater than zero.' using errcode = 'check_violation';
  end if;

  if p_employee_id is not null then
    select e.full_name, e.department_id, e.is_active into v_emp_name, v_emp_department, v_emp_active
      from public.stores_employees e where e.id = p_employee_id;
    if not found then
      raise exception 'That employee is not in the directory.' using errcode = 'check_violation';
    end if;
    if not v_emp_active then
      raise exception '% is no longer active in the directory.', v_emp_name using errcode = 'check_violation';
    end if;
  end if;

  -- Always a department: the one chosen, else the responsible person's.
  select * into v_dept from public.stores_departments
   where id = coalesce(p_department_id, v_emp_department);
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
    p_employee_id, v_emp_name,
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
    -p_quantity, p_quantity, p_employee_id, v_emp_name,
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
  -- Two arrivals of the same request (a retry while the first is still
  -- running) queue here, so the second sees the first's row and replays it
  -- instead of failing on the unique index.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
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
