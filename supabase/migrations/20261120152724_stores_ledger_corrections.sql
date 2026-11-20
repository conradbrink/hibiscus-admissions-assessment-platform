-- Hibiscus Stores: the third part of `stores_ledger`, as production ran it.
--
-- See `20261120150155_stores_ledger_handovers.sql`: the ledger file was
-- applied to production in three parts. This is the third, word for word:
-- adjustments, reversals and who may call the stock functions. The ledger
-- file already holds the same SQL, and every statement here is `create or
-- replace`, a revoke or a grant, so running it again changes nothing.

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
  -- Two arrivals of the same request (a retry while the first is still
  -- running) queue here, so the second sees the first's row and replays it
  -- instead of failing on the unique index.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
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
    -- A reversed checkout's lines still read as outstanding (the reversal
    -- put the stock back, not the line), and a completed one has nothing
    -- out: writing off either would take the stock off the shelf twice.
    if v_co.status <> 'open' then
      raise exception 'Checkout % is no longer open, so nothing on it can be written off.', v_co.reference
        using errcode = 'check_violation';
    end if;
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
  -- Two arrivals of the same request (a retry while the first is still
  -- running) queue here, so the second sees the first's row and replays it
  -- instead of failing on the unique index.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
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
      -- Put back the price and supplier this receipt set, unless a later
      -- receipt (still standing) has set them since, or somebody has typed
      -- a different one on the item.
      update public.stores_items i
         set purchase_price_minor = case when r.unit_price_minor is not null and i.purchase_price_minor is not distinct from r.unit_price_minor
                                         then r.price_before_minor else i.purchase_price_minor end,
             supplier = case when r.supplier is not null and i.supplier is not distinct from r.supplier
                             then r.supplier_before else i.supplier end
        from public.stores_receipts r
       where r.id = p_id
         and i.id = r.item_id
         and not r.is_opening
         and not exists (
           select 1 from public.stores_receipts later
            where later.item_id = r.item_id
              and later.reversal_id is null
              and later.recorded_at > r.recorded_at
              and (later.unit_price_minor is not null or later.supplier is not null)
         );
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
