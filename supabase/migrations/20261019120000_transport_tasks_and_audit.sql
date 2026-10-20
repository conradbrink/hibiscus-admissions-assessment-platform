-- School transport: who closes its tasks, and what its payouts tell the audit log.
--
-- Two things Claude Code's second review found (19 October 2026).
--
-- 1. The tasks transport raises (a refund to decide, a payment twice, money
--    after a cancellation) are for finance and the transport coordinator. Both
--    could read them, and neither could close them: `tasks_update` asks for
--    `applications.write` or `tasks.write`, which finance does not hold and a
--    coordinator holds nothing of. They stayed open for good. A task about a
--    booking can now also be closed by whoever runs transport or its money,
--    at a campus they cover, as every other task is.
--
-- 2. `transport_record_payout()` wrote the payout's charge, credit and total
--    into `audit_log`. An audit row with no application or family is read by
--    every `audit.read` holder, so a payout for one child told an admissions
--    manager what the provider is owed for that child: the figure the previous
--    migration made finance's alone. The row now says how many children and
--    credits, and names the payout; its money is on the payout, which only
--    finance reads.
--
-- A new migration rather than an edit, as before.

-- ---------------------------------------------------------------------------
-- 1. Who may close a transport task
-- ---------------------------------------------------------------------------

-- The arms of 20260912190000 unchanged, and one more: a task about a booking,
-- for those holding `transport.finance` or `transport.manage`. Everyone who
-- reads bookings holds one of the two. The campus rule stays in front of all
-- of them.
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    (campus_id is null or (select public.can_access_campus(campus_id)))
    and (
      (select public.has_permission('applications.write'))
      or (select public.has_permission('tasks.write'))
      or assignee_staff_id = (select auth.uid())
      or (
        transport_booking_id is not null
        and ((select public.has_permission('transport.finance')) or (select public.has_permission('transport.manage')))
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. The payout's audit row, without its money
-- ---------------------------------------------------------------------------

-- As 20261019100000 left it, except for the audit row at the end.
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
                             'charges', cardinality(v_charges), 'credits', jsonb_array_length(v_credits)));
  return v_payout;
end;
$$;

revoke all on function public.transport_record_payout(uuid, date, text, text, uuid[], jsonb) from public, anon;
grant execute on function public.transport_record_payout(uuid, date, text, text, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tasks'
                  and policyname = 'tasks_update' and qual like '%transport.finance%') then
    raise exception 'tasks_update does not let finance close a transport task';
  end if;
  if pg_get_functiondef('public.transport_record_payout(uuid, date, text, text, uuid[], jsonb)'::regprocedure) like '%''charge_minor''%' then
    raise exception 'transport_record_payout still writes its money into the audit log';
  end if;
end
$$;
