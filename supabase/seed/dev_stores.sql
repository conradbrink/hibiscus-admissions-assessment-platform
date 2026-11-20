-- Hibiscus Stores: sample data for a DEVELOPMENT database only.
--
-- Never run this against production. It adds made-up items, employees and
-- transactions so the screens can be tried with something on them. Every
-- line goes through the same stores_* functions the app uses, signed in as
-- the first active super administrator, so the demo reconciles exactly as
-- real data does.
--
--   psql "$DEV_DATABASE_URL" -1 -f supabase/seed/dev_stores.sql
--
-- Run it once on an empty Stores schema; run again, it stops at the first
-- item that already exists.

do $$
declare
  v_admin uuid;
  v_sig jsonb := '{"w":600,"h":260,"strokes":[[[40,170],[80,120],[120,180],[160,110],[210,175],[260,120],[320,160],[380,120],[450,150],[540,130]]]}'::jsonb;
  v_ack_out text;
  v_ack_in text;
  c_marketing uuid; c_sports uuid; c_clean_eq uuid; c_clean uuid; c_stat uuid; c_general uuid; c_event uuid;
  d_marketing uuid; d_sports uuid; d_cleaning uuid; d_maint uuid; d_academic uuid; d_admin uuid;
  e_sarah uuid; e_john uuid; e_mary uuid; e_thabo uuid; e_lerato uuid;
  i_speaker uuid; i_mic uuid; i_proj uuid; i_gazebo uuid; i_ball uuid; i_netball uuid; i_banner uuid;
  i_cleaner uuid; i_bags uuid; i_towels uuid; i_paper uuid; i_batt uuid; i_laptop uuid; i_drill uuid; i_mop uuid;
  v_res jsonb;
  v_co uuid;
  v_line uuid;
begin
  select sp.id into v_admin
    from public.staff_profiles sp
    join public.staff_roles sr on sr.staff_id = sp.id
    join public.roles r on r.id = sr.role_id
   where r.code = 'super_admin' and sp.is_active
   order by sp.created_at limit 1;
  if v_admin is null then
    raise exception 'dev_stores.sql needs an active super administrator to record the sample stock as.';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select value #>> '{}' into v_ack_out from public.settings where key = 'stores_checkout_acknowledgement';
  select value #>> '{}' into v_ack_in from public.settings where key = 'stores_return_acknowledgement';
  select id into c_marketing from public.stores_categories where name = 'Marketing';
  select id into c_sports from public.stores_categories where name = 'Sports Equipment';
  select id into c_clean_eq from public.stores_categories where name = 'Cleaning Equipment';
  select id into c_clean from public.stores_categories where name = 'Cleaning Consumables';
  select id into c_stat from public.stores_categories where name = 'Stationery';
  select id into c_general from public.stores_categories where name = 'General Equipment';
  select id into c_event from public.stores_categories where name = 'Event Equipment';
  select id into d_marketing from public.stores_departments where name = 'Marketing';
  select id into d_sports from public.stores_departments where name = 'Sports';
  select id into d_cleaning from public.stores_departments where name = 'Cleaning';
  select id into d_maint from public.stores_departments where name = 'Maintenance';
  select id into d_academic from public.stores_departments where name = 'Academic Staff';
  select id into d_admin from public.stores_departments where name = 'Administration';

  insert into public.stores_employees (full_name, department_id, employee_number, created_by) values
    ('Sarah Johnson', d_marketing, 'HS-1042', v_admin) returning id into e_sarah;
  insert into public.stores_employees (full_name, department_id, employee_number, created_by) values
    ('John Mokoena', d_sports, 'HS-0877', v_admin) returning id into e_john;
  insert into public.stores_employees (full_name, department_id, created_by) values
    ('Mary Williams', d_cleaning, v_admin) returning id into e_mary;
  insert into public.stores_employees (full_name, department_id, created_by) values
    ('Thabo Kgosi', d_maint, v_admin) returning id into e_thabo;
  insert into public.stores_employees (full_name, department_id, employee_number, created_by) values
    ('Lerato Molefe', d_academic, 'HS-1210', v_admin) returning id into e_lerato;

  i_speaker := (public.stores_create_item(gen_random_uuid(), 'Portable Speaker', c_event, 'reusable', 'each', 'JBL, with charger', 0, null, 185000, 'Game Stores', 6) ->> 'id')::uuid;
  i_mic := (public.stores_create_item(gen_random_uuid(), 'Wireless Microphone', c_event, 'reusable', 'each', null, 0, null, 95000, null, 4) ->> 'id')::uuid;
  i_proj := (public.stores_create_item(gen_random_uuid(), 'Projector', c_event, 'reusable', 'each', 'Epson, HDMI and VGA', 0, null, 650000, null, 2) ->> 'id')::uuid;
  i_gazebo := (public.stores_create_item(gen_random_uuid(), 'Gazebo 3 x 3 m', c_event, 'reusable', 'each', 'Branded, with weights', 0, null, 320000, null, 3) ->> 'id')::uuid;
  i_banner := (public.stores_create_item(gen_random_uuid(), 'Pull-up Banner', c_marketing, 'reusable', 'each', null, 0, null, 120000, null, 5) ->> 'id')::uuid;
  i_ball := (public.stores_create_item(gen_random_uuid(), 'Football', c_sports, 'reusable', 'each', 'Size 5', 0, null, 25000, null, 20) ->> 'id')::uuid;
  i_netball := (public.stores_create_item(gen_random_uuid(), 'Netball', c_sports, 'reusable', 'each', null, 0, null, 22000, null, 10) ->> 'id')::uuid;
  i_drill := (public.stores_create_item(gen_random_uuid(), 'Cordless Drill', c_general, 'reusable', 'each', null, 0, null, 140000, null, 2) ->> 'id')::uuid;
  i_mop := (public.stores_create_item(gen_random_uuid(), 'Mop and Bucket', c_clean_eq, 'reusable', 'set', null, 0, null, 18000, null, 6) ->> 'id')::uuid;
  i_laptop := (public.stores_create_item(gen_random_uuid(), 'Laptop', c_general, 'asset', 'each', 'For departmental use', 0, null, 980000, null, 4) ->> 'id')::uuid;
  i_cleaner := (public.stores_create_item(gen_random_uuid(), 'Floor Cleaner', c_clean, 'consumable', 'litres', null, 10, null, 3500, 'Cleanco', 40) ->> 'id')::uuid;
  i_bags := (public.stores_create_item(gen_random_uuid(), 'Refuse Bags', c_clean, 'consumable', 'packs', 'Black, 20 per pack', 10, null, 4500, null, 30) ->> 'id')::uuid;
  i_towels := (public.stores_create_item(gen_random_uuid(), 'Paper Towels', c_clean, 'consumable', 'rolls', null, 12, null, 1200, null, 24) ->> 'id')::uuid;
  i_paper := (public.stores_create_item(gen_random_uuid(), 'Printer Paper A4', c_stat, 'consumable', 'reams', null, 20, null, 6500, null, 15) ->> 'id')::uuid;
  i_batt := (public.stores_create_item(gen_random_uuid(), 'Batteries AA', c_stat, 'consumable', 'packs', '4 per pack', 10, null, 3000, null, 8) ->> 'id')::uuid;

  -- A delivery.
  perform public.stores_receive(gen_random_uuid(), i_cleaner, 20, public.stores_today() - 3, 'Cleanco', 3400, 'INV-20931', 'Monthly order');

  -- Sarah's marketing event, due back in three days.
  perform public.stores_checkout(gen_random_uuid(), e_sarah, public.stores_today() + 3,
    jsonb_build_array(jsonb_build_object('item_id', i_speaker, 'quantity', 2), jsonb_build_object('item_id', i_mic, 'quantity', 1), jsonb_build_object('item_id', i_proj, 'quantity', 1)),
    v_sig, v_ack_out, 'Open day');

  -- John's footballs: five out, three back, two outstanding and overdue.
  v_res := public.stores_checkout(gen_random_uuid(), e_john, public.stores_today(),
    jsonb_build_array(jsonb_build_object('item_id', i_ball, 'quantity', 5)), v_sig, v_ack_out, 'Inter-house practice');
  v_co := (v_res ->> 'id')::uuid;
  select id into v_line from public.stores_checkout_lines where checkout_id = v_co;
  perform public.stores_check_in(gen_random_uuid(), v_co, jsonb_build_array(jsonb_build_object('line_id', v_line, 'quantity', 3, 'condition', 'good')), v_sig, v_ack_in);
  -- Demo only: move the date back so the dashboard has something overdue.
  update public.stores_checkouts set expected_return_date = public.stores_today() - 4, checked_out_at = now() - interval '9 days' where id = v_co;

  -- A drill that came back damaged.
  v_res := public.stores_checkout(gen_random_uuid(), e_thabo, public.stores_today() + 1,
    jsonb_build_array(jsonb_build_object('item_id', i_drill, 'quantity', 1)), v_sig, v_ack_out);
  select id into v_line from public.stores_checkout_lines where checkout_id = (v_res ->> 'id')::uuid;
  perform public.stores_check_in(gen_random_uuid(), (v_res ->> 'id')::uuid,
    jsonb_build_array(jsonb_build_object('line_id', v_line, 'quantity', 1, 'condition', 'needs_maintenance', 'note', 'Chuck slips')), v_sig, v_ack_in);

  -- Mary's cleaning issue, and a stationery one that leaves paper low.
  perform public.stores_issue(gen_random_uuid(), e_mary,
    jsonb_build_array(jsonb_build_object('item_id', i_cleaner, 'quantity', 5), jsonb_build_object('item_id', i_bags, 'quantity', 10), jsonb_build_object('item_id', i_towels, 'quantity', 4)), null);
  perform public.stores_issue(gen_random_uuid(), e_lerato, jsonb_build_array(jsonb_build_object('item_id', i_paper, 'quantity', 5)), 'Grade 7 exams');

  -- A speaker and a laptop placed with Marketing for good.
  perform public.stores_assign(gen_random_uuid(), i_speaker, 1, d_marketing, e_sarah, 'Block 7, Marketing office', null);
  perform public.stores_assign(gen_random_uuid(), i_laptop, 2, d_admin, null, 'Front office', null);

  if exists (select 1 from public.stores_reconciliation()) then
    raise exception 'The sample data does not reconcile. Nothing was kept.';
  end if;
end
$$;
