-- Development seed for school transport. NOT a migration: nothing here belongs
-- in a real school's database. It opens booking on a laptop so the parent
-- journey at /transport can be walked end to end the day the schema is
-- applied, before the school has written its terms or chosen its dates.
--
-- What it creates, all clearly labelled as samples:
--   - SAMPLE transport terms, published as the newest version;
--   - a published term starting next Monday, open for booking from today,
--     with its three months;
--   - booking switched on, and a sample office contact.
--
-- Run once against a development database, with PAYMENT_PROVIDER=dev:
--   psql "$DATABASE_URL" -f supabase/seed/dev_transport.sql
-- It refuses to run against a database that already has real terms.

do $$
declare
  v_today date := (now() at time zone 'Africa/Gaborone')::date;
  v_start date;
  v_list uuid;
  v_term uuid;
  v_version int;
  i int;
begin
  if exists (select 1 from public.transport_terms where body_text not like 'SAMPLE%') then
    raise exception 'This database has real transport terms. The development seed is not for it.';
  end if;
  if exists (select 1 from public.transport_periods where label like 'Sample term%') then
    raise notice 'The transport sample is already here.';
    return;
  end if;

  select id into v_list from public.transport_price_lists order by created_at limit 1;
  if v_list is null then
    raise exception 'No transport price list: apply the migrations first.';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.transport_terms;
  insert into public.transport_terms (version, body_text, published_at)
  values (v_version,
    'SAMPLE TERMS FOR DEVELOPMENT ONLY.' || chr(10) || chr(10) ||
    '1. The driver waits two minutes at the pick-up point.' || chr(10) ||
    '2. Tell the school office by 07:00 if your child is not riding that day.' || chr(10) ||
    '3. A term booking is paid before the term starts.',
    now());

  -- Next Monday, so the term is always in the future when the seed runs.
  v_start := v_today + (8 - extract(isodow from v_today)::int);
  insert into public.transport_periods (kind, label, starts_on, ends_on, booking_opens_on, booking_closes_on, price_list_id, is_published)
  values ('term', 'Sample term', v_start, v_start + 89, v_today, v_start + 20, v_list, true)
  returning id into v_term;

  for i in 1..3 loop
    insert into public.transport_periods (kind, term_period_id, month_index, label, starts_on, ends_on, booking_opens_on, booking_closes_on, price_list_id, is_published)
    values ('month', v_term, i, format('Sample term, month %s', i),
            v_start + (i - 1) * 30, v_start + i * 30 - 1, v_today, v_start + (i - 1) * 30 + 5, v_list, true);
  end loop;

  update public.settings set value = 'true' where key = 'transport_booking_enabled';
  update public.settings set value = '"the sample transport desk on 71 000 000"' where key = 'transport_office_contact';
end
$$;
