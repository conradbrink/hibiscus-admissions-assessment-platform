-- Security regression suite.
--
-- Run it against a database built from the migrations (replay_local.sh does
-- this automatically) or paste it into a project's SQL editor. It runs inside
-- one transaction that ALWAYS aborts: the last statement raises either
--
--   ALL SECURITY CHECKS PASSED (rolled back)
--   SECURITY REGRESSIONS: …
--
-- so it leaves nothing behind and is safe against production.
--
-- The checks are written as attacks, not as assertions about policy text,
-- because a policy that reads correctly can still be wrong. Every attack has
-- a control asserting the legitimate case still works — a lock that also
-- breaks real use is one the next person removes in a hurry. Fixtures are
-- created here, never borrowed from real rows.
--
-- If this file raises anything other than PASSED or SECURITY REGRESSIONS,
-- the suite is broken, not the database.

-- Helpers live in pg_temp so they vanish with the session and need no
-- privileges beyond what the session already has.
create or replace function pg_temp.impersonate(p_user uuid)
returns void language plpgsql as $h$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end
$h$;

create or replace function pg_temp.service()
returns void language plpgsql as $h$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end
$h$;

do $$
declare
  v_fail text := '';
  -- fixtures
  u_admin uuid := gen_random_uuid();
  u_staff uuid := gen_random_uuid();
  u_assessor uuid := gen_random_uuid();
  u_campus_admin uuid := gen_random_uuid();
  u_inactive uuid := gen_random_uuid();
  u_noroles uuid := gen_random_uuid();
  c_block7 uuid;
  c_broadhurst uuid;
  g_stage4 uuid;
  i_intake uuid;
  app_block7 uuid;
  app_broadhurst uuid;
  s_session uuid;
  s_empty uuid;
  v_count int;
  v_id uuid;



begin
  -- -------------------------------------------------------------------------
  -- Fixtures (as superuser / service role)
  -- -------------------------------------------------------------------------
  insert into auth.users (id, email) values
    (u_admin, 'sec-admin@test.invalid'),
    (u_staff, 'sec-staff@test.invalid'),
    (u_assessor, 'sec-assessor@test.invalid'),
    (u_campus_admin, 'sec-campus@test.invalid'),
    (u_inactive, 'sec-inactive@test.invalid'),
    (u_noroles, 'sec-noroles@test.invalid');
  insert into public.staff_profiles (id, full_name, email, is_active) values
    (u_admin, 'Sec Admin', 'sec-admin@test.invalid', true),
    (u_staff, 'Sec Staff', 'sec-staff@test.invalid', true),
    (u_assessor, 'Sec Assessor', 'sec-assessor@test.invalid', true),
    (u_campus_admin, 'Sec Campus', 'sec-campus@test.invalid', true),
    (u_inactive, 'Sec Inactive', 'sec-inactive@test.invalid', false),
    (u_noroles, 'Sec NoRoles', 'sec-noroles@test.invalid', true);
  insert into public.staff_roles (staff_id, role_id)
  select u, r.id from (values
    (u_admin, 'super_admin'),
    (u_staff, 'admissions_staff'),
    (u_assessor, 'assessor'),
    (u_campus_admin, 'campus_admin'),
    (u_inactive, 'super_admin')
  ) as x(u, code) join public.roles r on r.code = x.code;

  select id into c_block7 from public.campuses where code = 'block7';
  select id into c_broadhurst from public.campuses where code = 'broadhurst';
  select id into g_stage4 from public.grades where code = 'stage_4';
  select id into i_intake from public.intakes where is_open order by starts_on limit 1;
  if c_block7 is null or c_broadhurst is null or g_stage4 is null or i_intake is null then
    raise exception 'SUITE BROKEN: seed data missing (campuses/grades/intakes)';
  end if;

  insert into public.staff_campuses (staff_id, campus_id) values (u_campus_admin, c_broadhurst);

  select application_id into app_block7 from public.create_application(
    'Sec','Parent','sec-parent-a@test.invalid','sec-parent-a@test.invalid',null,null,
    'Child','A','2017-04-15', c_block7, g_stage4, g_stage4, i_intake, 'assessment');
  select application_id into app_broadhurst from public.create_application(
    'Sec','Parent','sec-parent-b@test.invalid','sec-parent-b@test.invalid',null,null,
    'Child','B','2017-04-15', c_broadhurst, g_stage4, g_stage4, i_intake, 'assessment');

  insert into public.sessions (kind, campus_id, starts_at, ends_at, capacity, is_published, created_by)
  values ('assessment', c_block7, now() + interval '2 days', now() + interval '2 days 1 hour', 5, true, u_admin)
  returning id into s_session;
  insert into public.sessions (kind, campus_id, starts_at, ends_at, capacity, is_published, created_by)
  values ('assessment', c_block7, now() + interval '3 days', now() + interval '3 days 1 hour', 5, false, u_admin)
  returning id into s_empty;
  perform public.book_session(app_block7, s_session);

  -- -------------------------------------------------------------------------
  -- 1. Anonymous callers see nothing
  -- -------------------------------------------------------------------------
  begin
    execute 'set local role anon';
    select count(*) into v_count from public.applications;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('1: anon can read applications'); end if;
    select count(*) into v_count from public.contacts;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('1: anon can read contacts'); end if;
    select count(*) into v_count from public.email_messages;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('1: anon can read email_messages'); end if;
  exception
    -- EXECUTE on the RLS helpers is revoked from anon, so the policy itself
    -- errors before it can return a row. A hard refusal is a refusal; the
    -- anon key is only ever used for staff sign-in, never for table reads.
    when insufficient_privilege then null;
    when others then
      v_fail := v_fail || E'\n  - ' || ('1: unexpected error as anon: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 2. A signed-in account with no roles sees nothing (and control: staff sees)
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_noroles);
    select count(*) into v_count from public.applications;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('2: account with no roles can read applications'); end if;
    if public.has_permission('applications.read') then v_fail := v_fail || E'\n  - ' || ('2: has_permission true with no roles'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('2: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.applications;
    if v_count < 2 then v_fail := v_fail || E'\n  - ' || ('2 control: admissions staff cannot read applications'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('2 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 3. A deactivated super admin has nothing
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_inactive);
    select count(*) into v_count from public.applications;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('3: deactivated account can still read applications'); end if;
    if public.has_permission('admin') then v_fail := v_fail || E'\n  - ' || ('3: deactivated account still has admin'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('3: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 4. Campus restriction: sees own campus, not the other
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_campus_admin);
    select count(*) into v_count from public.applications where id = app_broadhurst;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('4 control: campus admin cannot see own-campus application'); end if;
    select count(*) into v_count from public.applications where id = app_block7;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4: campus admin can see another campus''s application'); end if;
    select count(*) into v_count from public.contacts c
      where exists (select 1 from public.applications a where a.contact_id = c.id and a.id = app_block7);
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4: campus admin can see another campus''s contact'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('4: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 5. Staff cannot move the pipeline: status is the engine's column
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    update public.applications set status = 'enrolled' where id = app_block7;
    v_fail := v_fail || E'\n  - ' || ('5: admissions staff updated applications.status directly');
  exception
    when insufficient_privilege then null; -- correct: column grant refused it
    when others then v_fail := v_fail || E'\n  - ' || ('5: refused, but by "' || sqlerrm || '" rather than the column grant');
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_staff);
    update public.applications set current_school = 'Some School' where id = app_block7;
    get diagnostics v_count = row_count;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('5 control: staff cannot edit an editable column'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('5 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 6. Assessor (read-only on applications) cannot edit them
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_assessor);
    update public.applications set current_school = 'X' where id = app_block7;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('6: assessor updated an application'); end if;
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('6: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 7. The audit log cannot be edited or deleted, even by the super admin
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    update public.audit_log set action = 'tampered' where true;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('7: super admin updated audit_log rows'); end if;
    delete from public.audit_log where true;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('7: super admin deleted audit_log rows'); end if;
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('7: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 8. Engine and token functions are not callable by staff
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    perform public.commit_transition(app_block7, null, 'enrolled', null, null, '{"type":"x","summary":"x"}'::jsonb);
    v_fail := v_fail || E'\n  - ' || ('8: authenticated could call commit_transition');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('8: commit_transition refused by "' || sqlerrm || '" rather than EXECUTE');
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    perform * from public.consume_token('x', null, null);
    v_fail := v_fail || E'\n  - ' || ('8: authenticated could call consume_token');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('8: consume_token refused by "' || sqlerrm || '" rather than EXECUTE');
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    perform public.next_application_reference();
    v_fail := v_fail || E'\n  - ' || ('8: authenticated could allocate a reference');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('8: next_application_reference refused by "' || sqlerrm || '"');
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 9. Tokens: hashes visible to staff, but not writable; rate_limits sealed
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    insert into public.access_tokens (application_id, purpose, token_hash, expires_at)
    values (app_block7, 'next_step', 'forged', now() + interval '1 day');
    v_fail := v_fail || E'\n  - ' || ('9: staff minted an access token');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('9: token insert refused by "' || sqlerrm || '"');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    select count(*) into v_count from public.rate_limits;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('9: rate_limits readable by staff'); end if;
    select count(*) into v_count from public.reference_counters;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('9: reference_counters readable by staff'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('9: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 10. Notes are pinned to their author
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    insert into public.notes (application_id, author_staff_id, body) values (app_block7, u_admin, 'forged');
    v_fail := v_fail || E'\n  - ' || ('10: staff wrote a note as somebody else');
  exception
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('10: refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_staff);
    insert into public.notes (application_id, author_staff_id, body) values (app_block7, u_staff, 'mine');
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('10 control: staff cannot write their own note: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 11. A booked session cannot be deleted; an empty one can
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    delete from public.sessions where id = s_session;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('11: deleted a session with a booking on it'); end if;
    delete from public.sessions where id = s_empty;
    get diagnostics v_count = row_count;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('11 control: could not delete an empty session'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('11: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 12. Bookings and timeline are not writable by staff (engine only)
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    update public.bookings set status = 'completed' where application_id = app_block7;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('12: staff updated a booking directly'); end if;
    insert into public.application_events (application_id, type, actor_type, summary)
    values (app_block7, 'forged', 'staff', 'forged');
    v_fail := v_fail || E'\n  - ' || ('12: staff inserted a timeline event directly');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('12: refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 13. Jobs are admin-only to read
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.jobs;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('13: admissions staff can read the job queue'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('13: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 14. Only the last super admin guard is application-level; the database
  --     at least refuses deleting a system role
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    delete from public.roles where code = 'super_admin';
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('14: deleted a system role'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('14: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- Verdict. Raise either way so the transaction rolls back.
  -- -------------------------------------------------------------------------
  if v_fail <> '' then
    raise exception 'SECURITY REGRESSIONS:%', v_fail;
  end if;
  raise exception 'ALL SECURITY CHECKS PASSED (rolled back)';
end
$$;
