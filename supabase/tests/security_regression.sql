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
  u_finance uuid := gen_random_uuid();
  u_author uuid := gen_random_uuid();
  -- Campus scoping fixtures (Phase 3): a campus administrator with no
  -- campus assigned, and an admissions manager limited to Broadhurst.
  u_campus_none uuid := gen_random_uuid();
  u_campus_mgr uuid := gen_random_uuid();
  -- Phase 2 fixtures
  p2_competency uuid;
  p2_bank uuid;
  p2_question uuid;
  p2_template uuid;
  p2_form uuid;
  p2_form_question uuid;
  p2_booking uuid;
  p2_attempt uuid;
  p2_ruleset uuid;
  p2_decision uuid;
  p2_offer uuid;
  p2_offer_template uuid;
  p2_year uuid;
  -- Phase 3 fixtures
  p3_acceptance uuid;
  p3_request uuid;
  p3_payment uuid;
  p3_document uuid;
  p3_agreement uuid;
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
  -- Phase 4 fixtures
  p4_message uuid;
  p4_export uuid;
  app_retain uuid;
  c_retain uuid;
  v_json jsonb;
  v_text text;



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
    (u_noroles, 'sec-noroles@test.invalid'),
    (u_finance, 'sec-finance@test.invalid'),
    (u_author, 'sec-author@test.invalid'),
    (u_campus_none, 'sec-campus-none@test.invalid'),
    (u_campus_mgr, 'sec-campus-mgr@test.invalid');
  insert into public.staff_profiles (id, full_name, email, is_active) values
    (u_admin, 'Sec Admin', 'sec-admin@test.invalid', true),
    (u_staff, 'Sec Staff', 'sec-staff@test.invalid', true),
    (u_assessor, 'Sec Assessor', 'sec-assessor@test.invalid', true),
    (u_campus_admin, 'Sec Campus', 'sec-campus@test.invalid', true),
    (u_inactive, 'Sec Inactive', 'sec-inactive@test.invalid', false),
    (u_noroles, 'Sec NoRoles', 'sec-noroles@test.invalid', true),
    (u_finance, 'Sec Finance', 'sec-finance@test.invalid', true),
    (u_author, 'Sec Author', 'sec-author@test.invalid', true),
    (u_campus_none, 'Sec Campus None', 'sec-campus-none@test.invalid', true),
    (u_campus_mgr, 'Sec Campus Manager', 'sec-campus-mgr@test.invalid', true);
  insert into public.staff_roles (staff_id, role_id)
  select u, r.id from (values
    (u_admin, 'super_admin'),
    (u_staff, 'admissions_staff'),
    (u_assessor, 'assessor'),
    (u_campus_admin, 'campus_admin'),
    (u_inactive, 'super_admin'),
    (u_finance, 'finance'),
    (u_author, 'content_author'),
    (u_campus_none, 'campus_admin'),
    (u_campus_mgr, 'admissions_manager')
  ) as x(u, code) join public.roles r on r.code = x.code;

  select id into c_block7 from public.campuses where code = 'block7';
  select id into c_broadhurst from public.campuses where code = 'broadhurst';
  select id into g_stage4 from public.grades where code = 'stage_4';
  select id into i_intake from public.intakes where is_open order by starts_on limit 1;
  if c_block7 is null or c_broadhurst is null or g_stage4 is null or i_intake is null then
    raise exception 'SUITE BROKEN: seed data missing (campuses/grades/intakes)';
  end if;

  insert into public.staff_campuses (staff_id, campus_id) values (u_campus_admin, c_broadhurst), (u_campus_mgr, c_broadhurst);

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

  -- Phase 2 fixtures: a question with its key, a frozen form with its key,
  -- an attempt with a response, a decision, an active ruleset, an offer.
  -- All inserted as the service role, the way the engine does it.
  select id into p2_competency from public.competencies where code = 'reading';
  select id into p2_offer_template from public.offer_templates where key = 'standard' and is_active;
  select ay.id into p2_year from public.intakes i join public.academic_years ay on ay.id = i.academic_year_id where i.id = i_intake;
  if p2_competency is null or p2_offer_template is null or p2_year is null then
    raise exception 'SUITE BROKEN: Phase 2 seed data missing (competencies/offer_templates/academic_years)';
  end if;
  insert into public.question_banks (name, status, created_by) values ('Sec bank', 'active', u_author) returning id into p2_bank;
  insert into public.questions (bank_id, competency_id, type, stem, status, created_by)
  values (p2_bank, p2_competency, 'numeric', 'What is 2 + 2?', 'active', u_author) returning id into p2_question;
  insert into public.question_answers (question_id, answer) values (p2_question, '{"value": 4, "tolerance": 0}'::jsonb);
  insert into public.assessment_templates (name, grade_sort_min, grade_sort_max, time_limit_minutes, status, created_by)
  values ('Sec template', 0, 100, 30, 'active', u_author) returning id into p2_template;
  insert into public.assessment_forms (application_id, template_id, template_version) values (app_block7, p2_template, 1) returning id into p2_form;
  insert into public.form_questions (form_id, section_position, section_title, position, question_id, question_version, competency_id, type, stem, marks)
  values (p2_form, 0, 'Numbers', 0, p2_question, 1, p2_competency, 'numeric', 'What is 2 + 2?', 1) returning id into p2_form_question;
  insert into public.form_answer_keys (form_question_id, answer) values (p2_form_question, '{"value": 4, "tolerance": 0}'::jsonb);
  select id into p2_booking from public.bookings where application_id = app_block7 and status = 'booked';
  insert into public.attempts (application_id, booking_id, form_id, status, launched_by, started_at, time_limit_seconds, expires_at)
  values (app_block7, p2_booking, p2_form, 'in_progress', u_admin, now(), 1800, now() + interval '30 minutes') returning id into p2_attempt;
  insert into public.attempt_responses (attempt_id, form_question_id, response) values (p2_attempt, p2_form_question, '{"value": 4}'::jsonb);
  insert into public.kiosk_codes (attempt_id, code_hash, expires_at) values (p2_attempt, 'sec-hash', now() + interval '15 minutes');
  -- Rules are added while the ruleset is a draft, then it is activated:
  -- the same order the admin screen follows, and the only one the freeze
  -- triggers allow.
  insert into public.admission_rulesets (name, status, created_by)
  values ('Sec ruleset', 'draft', u_admin) returning id into p2_ruleset;
  insert into public.admission_rules (ruleset_id, scope, operator, threshold, severity, label)
  values (p2_ruleset, 'overall', '>=', 40, 'review', 'Overall at least 40%');
  update public.admission_rulesets set status = 'active', activated_at = now(), activated_by = u_admin where id = p2_ruleset;
  insert into public.admission_decisions (application_id, attempt_id, ruleset_id, ruleset_version, computed_outcome, final_outcome, decided_by)
  values (app_block7, p2_attempt, p2_ruleset, 1, 'staff_review', 'staff_review', 'rules') returning id into p2_decision;
  insert into public.offers (application_id, template_id, template_version, currency, rendered_html, terms_html, status)
  values (app_block7, p2_offer_template, 1, 'BWP', '<p>offer</p>', '<p>terms</p>', 'pending_approval') returning id into p2_offer;
  -- Phase 3: an accepted offer with its payment request and one receipt,
  -- inserted the way the engine does it (service role).
  insert into public.offer_acceptances (application_id, offer_id, template_id, template_version, decision, terms_accepted, terms_hash, fees)
  values (app_block7, p2_offer, p2_offer_template, 1, 'accepted', true, 'sec-hash', '{}'::jsonb) returning id into p3_acceptance;
  insert into public.payment_requests (application_id, offer_id, acceptance_id, currency, amount_minor, due_at)
  values (app_block7, p2_offer, p3_acceptance, 'BWP', 750000, now() + interval '14 days') returning id into p3_request;
  insert into public.payments (payment_request_id, application_id, method, provider, company_ref, status, amount_minor, currency)
  values (p3_request, app_block7, 'eft', 'bank', 'SEC-EFT', 'pending', 750000, 'BWP') returning id into p3_payment;
  insert into public.registrations (application_id, legal_first_name, identity_number, allergies) values (app_block7, 'Child', 'ID-SEC-1', 'peanuts');
  insert into public.registration_contacts (application_id, kind, first_name, last_name, relationship, phone)
  values (app_block7, 'emergency', 'Sec', 'Aunt', 'other', '+26771234567');
  insert into public.documents (application_id, requirement_code, storage_path, original_filename, mime_type, size_bytes, sha256, uploaded_by)
  values (app_block7, 'birth_certificate', 'applications/' || app_block7 || '/sec', 'birth.pdf', 'application/pdf', 1234, 'sha', 'parent') returning id into p3_document;
  select id into p3_agreement from public.agreement_templates where key = 'learner_code_of_conduct' and is_active;
  insert into public.agreement_acceptances (application_id, agreement_template_id, template_key, template_version, body_hash, signature_name, signature_svg)
  select app_block7, id, key, version, 'hash', 'Sec Parent', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200"><path d="M10 10 L200 100"/></svg>'
    from public.agreement_templates where id = p3_agreement;
  insert into public.audit_log (actor_type, actor_id, action, entity_type, entity_id, application_id)
  values ('staff', u_admin, 'sec.block7', 'application', app_block7, app_block7),
         ('staff', u_admin, 'sec.broadhurst', 'application', app_broadhurst, app_broadhurst),
         ('staff', u_admin, 'sec.no_application', 'staff_profile', u_admin, null);
  -- Phase 4: a WhatsApp message, a summary and an export batch on Block 7,
  -- and a third application that retention will anonymise.
  insert into public.messages (application_id, direction, template_key, to_normalised, provider, status, rendered_text, idempotency_key)
  values (app_block7, 'out', 'booking_confirmed', '+26771234567', 'dev', 'sent', 'Hi Sec', 'sec-msg') returning id into p4_message;
  insert into public.application_summaries (application_id, input_hash, headline, paragraph, source)
  values (app_block7, 'h', 'Sec headline', 'Sec paragraph', 'deterministic');
  insert into public.student_exports (campus_id, format, record_count, filename, created_by)
  values (c_block7, 'csv', 0, 'sec.csv', u_admin) returning id into p4_export;
  select application_id into app_retain from public.create_application(
    'Retain','Parent','sec-parent-r@test.invalid','sec-parent-r@test.invalid','+26771000000','+26771000000',
    'Child','R','2017-04-15', c_block7, g_stage4, g_stage4, i_intake, 'assessment');
  select contact_id into c_retain from public.applications where id = app_retain;
  insert into public.notes (application_id, author_staff_id, body) values (app_retain, u_admin, 'sensitive note');

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
  -- 4b. The same restriction on everything that hangs off an application
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_campus_admin);
    select count(*) into v_count from public.attempts where id = p2_attempt;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s attempt'); end if;
    select count(*) into v_count from public.offers where id = p2_offer;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s offer'); end if;
    select count(*) into v_count from public.admission_decisions where id = p2_decision;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s decision'); end if;
    select count(*) into v_count from public.attempt_responses where attempt_id = p2_attempt;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s responses'); end if;
    select count(*) into v_count from public.tasks where application_id = app_block7;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s tasks'); end if;
    select count(*) into v_count from public.payment_requests where id = p3_request;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s payment request'); end if;
    select count(*) into v_count from public.offer_acceptances where id = p3_acceptance;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s acceptance'); end if;
    select count(*) into v_count from public.registrations where application_id = app_block7;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s registration'); end if;
    select count(*) into v_count from public.registration_contacts where application_id = app_block7;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s registration contacts'); end if;
    select count(*) into v_count from public.documents where id = p3_document;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s documents'); end if;
    select count(*) into v_count from public.agreement_acceptances where application_id = app_block7;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('4b: campus admin can see another campus''s agreement acceptances'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('4b: unexpected error: ' || sqlerrm);
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
  -- 15. Answer keys are for authors only: the bank's key and the frozen
  --     form's key are invisible to everyone else, including super admin's
  --     colleagues with every applicant permission. (Super admin holds
  --     `admin`, which satisfies every check by design.)
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.question_answers where question_id = p2_question;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('15: admissions staff can read question_answers'); end if;
    select count(*) into v_count from public.form_answer_keys where form_question_id = p2_form_question;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('15: admissions staff can read form_answer_keys'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('15: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_assessor);
    select count(*) into v_count from public.form_answer_keys where form_question_id = p2_form_question;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('15: assessor can read form_answer_keys'); end if;
    select count(*) into v_count from public.form_questions where id = p2_form_question;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('15 control: assessor cannot read the form question they mark'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('15: unexpected error as assessor: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_author);
    select count(*) into v_count from public.question_answers where question_id = p2_question;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('15 control: content author cannot read question_answers'); end if;
    select count(*) into v_count from public.form_answer_keys where form_question_id = p2_form_question;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('15 control: content author cannot read form_answer_keys'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('15 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 16. Marks are the engine's: no staff account can write responses,
  --     attempts or scores directly, even the super admin
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    update public.attempt_responses set marks_awarded = 99, is_correct = true where attempt_id = p2_attempt;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('16: super admin updated attempt_responses directly'); end if;
    update public.attempts set status = 'marked' where id = p2_attempt;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('16: super admin updated attempts directly'); end if;
    insert into public.attempt_scores (attempt_id, scope, scope_id, raw, max, percent, band)
    values (p2_attempt, 'overall', null, 1, 1, 100, 'exceeding');
    v_fail := v_fail || E'\n  - ' || ('16: super admin inserted attempt_scores directly');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('16: refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_assessor);
    select count(*) into v_count from public.attempt_responses where attempt_id = p2_attempt;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('16 control: assessor cannot read the responses they mark'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('16 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 17. The kiosk's tables are sealed: codes are service-role only, and the
  --     anon key (which the kiosk page never uses) sees no form
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    select count(*) into v_count from public.kiosk_codes;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('17: kiosk_codes readable by staff'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('17: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    execute 'set local role anon';
    select count(*) into v_count from public.form_questions;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('17: anon can read form_questions'); end if;
    select count(*) into v_count from public.attempts;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('17: anon can read attempts'); end if;
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('17: unexpected error as anon: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 18. The delivery RPCs are not callable by any staff account
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    perform public.launch_attempt(app_block7, p2_booking, p2_template, 1.0, u_admin, null);
    v_fail := v_fail || E'\n  - ' || ('18: authenticated could call launch_attempt');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('18: launch_attempt refused by "' || sqlerrm || '" rather than EXECUTE');
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    perform public.start_attempt(p2_attempt, null);
    v_fail := v_fail || E'\n  - ' || ('18: authenticated could call start_attempt');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('18: start_attempt refused by "' || sqlerrm || '" rather than EXECUTE');
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    perform public.record_response(p2_attempt, p2_form_question, '{"value": 5}'::jsonb, 30);
    v_fail := v_fail || E'\n  - ' || ('18: authenticated could call record_response');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('18: record_response refused by "' || sqlerrm || '" rather than EXECUTE');
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    perform public.submit_attempt(p2_attempt, false);
    v_fail := v_fail || E'\n  - ' || ('18: authenticated could call submit_attempt');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('18: submit_attempt refused by "' || sqlerrm || '" rather than EXECUTE');
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 19. Admission decisions are append-only for everyone, the service role
  --     included: the trigger, not a policy, is what binds
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    update public.admission_decisions set final_outcome = 'approved' where id = p2_decision;
    v_fail := v_fail || E'\n  - ' || ('19: service role updated an admission decision');
  exception when others then
    if sqlerrm not like '%append-only%' then
      v_fail := v_fail || E'\n  - ' || ('19: update refused by "' || sqlerrm || '" rather than the append-only trigger');
    end if;
  end;
  begin
    perform pg_temp.service();
    delete from public.admission_decisions where id = p2_decision;
    v_fail := v_fail || E'\n  - ' || ('19: service role deleted an admission decision');
  exception when others then
    if sqlerrm not like '%append-only%' then
      v_fail := v_fail || E'\n  - ' || ('19: delete refused by "' || sqlerrm || '" rather than the append-only trigger');
    end if;
  end;
  begin
    perform pg_temp.impersonate(u_admin);
    insert into public.admission_decisions (application_id, computed_outcome, final_outcome, decided_by, staff_id, override_reason)
    values (app_block7, 'staff_review', 'approved', 'staff', u_admin, 'forged');
    v_fail := v_fail || E'\n  - ' || ('19: super admin inserted an admission decision directly');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('19: insert refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.admission_decisions where id = p2_decision;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('19 control: admissions staff cannot read a decision'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('19 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 20. An active ruleset is frozen; a draft is editable
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    update public.admission_rulesets set name = 'Sec ruleset (edited)' where id = p2_ruleset;
    v_fail := v_fail || E'\n  - ' || ('20: an active ruleset accepted an edit');
  exception when others then
    if sqlerrm not like '%cannot be edited%' then
      v_fail := v_fail || E'\n  - ' || ('20: refused by "' || sqlerrm || '" rather than the freeze trigger');
    end if;
  end;
  begin
    perform pg_temp.impersonate(u_admin);
    insert into public.admission_rulesets (name, status, created_by) values ('Sec draft', 'draft', u_admin) returning id into v_id;
    update public.admission_rulesets set name = 'Sec draft (edited)' where id = v_id;
    get diagnostics v_count = row_count;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('20 control: a draft ruleset refused an edit'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('20 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 21. Offers: visible with offers.read, invisible to an assessor, and
  --     never writable by staff (approval goes through the engine)
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_assessor);
    select count(*) into v_count from public.offers where id = p2_offer;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('21: assessor can read offers'); end if;
    select count(*) into v_count from public.fee_schedules;
    -- Zero rows is the expected shape; the policy is what is under test.
    if public.has_permission('offers.read') then v_fail := v_fail || E'\n  - ' || ('21: assessor holds offers.read'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('21: unexpected error as assessor: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_finance);
    select count(*) into v_count from public.offers where id = p2_offer;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('21 control: finance cannot read offers'); end if;
    update public.offers set status = 'sent', sent_at = now() where id = p2_offer;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('21: finance updated an offer directly'); end if;
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('21: unexpected error as finance: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    update public.offers set status = 'sent', sent_at = now() where id = p2_offer;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('21: super admin updated an offer directly'); end if;
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('21: unexpected error as super admin: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 22. Fee schedules: finance writes them, admissions staff only reads;
  --     the currency follows the campus whatever the caller sends
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    insert into public.fee_schedules (name, campus_id, academic_year_id, currency) values ('Sec fees', c_block7, p2_year, 'BWP');
    v_fail := v_fail || E'\n  - ' || ('22: admissions staff inserted a fee schedule');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('22: refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_finance);
    insert into public.fee_schedules (name, campus_id, academic_year_id, currency) values ('Sec fees', c_block7, p2_year, 'ZAR') returning id into v_id;
    if (select currency from public.fee_schedules where id = v_id) <> 'BWP' then
      v_fail := v_fail || E'\n  - ' || ('22: a Botswana campus accepted a ZAR fee schedule');
    end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('22 control: finance cannot create a fee schedule: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 23. A campus-scoped role with no campus assigned sees nothing; assigning
  --     one campus shows exactly that campus (fail closed, then open by design)
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_campus_none);
    select count(*) into v_count from public.applications;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('23: campus admin with no campus can see applications'); end if;
    select count(*) into v_count from public.bookings;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('23: campus admin with no campus can see bookings'); end if;
    if public.can_access_campus(c_block7) then v_fail := v_fail || E'\n  - ' || ('23: can_access_campus is open for a campus admin with no campus'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('23: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    insert into public.staff_campuses (staff_id, campus_id) values (u_campus_none, c_block7);
    perform pg_temp.impersonate(u_campus_none);
    select count(*) into v_count from public.applications where id = app_block7;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('23 control: campus admin cannot see the campus just assigned'); end if;
    select count(*) into v_count from public.applications where id = app_broadhurst;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('23 control: assigning one campus opened another'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('23 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 24. The audit log follows the application's campus; rows about nothing
  --     in particular stay visible to audit.read
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_campus_mgr);
    if not public.has_permission('audit.read') then v_fail := v_fail || E'\n  - ' || ('24: fixture: campus manager lacks audit.read'); end if;
    select count(*) into v_count from public.audit_log where action = 'sec.block7';
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('24: campus manager can read another campus''s audit rows'); end if;
    select count(*) into v_count from public.audit_log where action = 'sec.broadhurst';
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('24 control: campus manager cannot read own campus''s audit rows'); end if;
    select count(*) into v_count from public.audit_log where action = 'sec.no_application';
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('24 control: audit rows with no application are hidden'); end if;
    -- and the same person, being a manager, may approve offers — for their campus only
    select count(*) into v_count from public.offers where id = p2_offer;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('24: campus manager can see another campus''s offer'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('24: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 26. v_accessible_campuses offers each person only what the policies allow
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.v_accessible_campuses;
    if v_count < 2 then v_fail := v_fail || E'\n  - ' || ('26 control: head-office staff do not see every active campus'); end if;
    perform pg_temp.service();
    perform pg_temp.impersonate(u_campus_admin);
    select count(*) into v_count from public.v_accessible_campuses;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('26: restricted staff see ' || v_count || ' campuses in the filter, expected 1'); end if;
    select count(*) into v_count from public.v_accessible_campuses where id = c_broadhurst;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('26: restricted staff do not see their own campus in the filter'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('26: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 27. Money is the engine's: no staff account writes acceptances, requests
  --     or payments directly, super admin included
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    update public.payments set status = 'succeeded' where id = p3_payment;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('27: super admin marked a payment succeeded directly'); end if;
    update public.payment_requests set status = 'paid', paid_minor = amount_minor where id = p3_request;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('27: super admin marked a request paid directly'); end if;
    insert into public.offer_acceptances (application_id, offer_id, template_id, template_version, decision, terms_accepted, terms_hash)
    values (app_broadhurst, p2_offer, p2_offer_template, 1, 'accepted', true, 'forged');
    v_fail := v_fail || E'\n  - ' || ('27: super admin inserted an acceptance directly');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('27: refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_finance);
    insert into public.payments (payment_request_id, application_id, method, provider, company_ref, status, amount_minor, currency)
    values (p3_request, app_block7, 'eft', 'bank', 'FORGED', 'succeeded', 750000, 'BWP');
    v_fail := v_fail || E'\n  - ' || ('27: finance inserted a payment directly');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('27: finance insert refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();

  begin
    perform pg_temp.impersonate(u_admin);
    update public.registrations set identity_number = 'tampered' where application_id = app_block7;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('27: super admin edited a registration directly'); end if;
    update public.documents set review_status = 'accepted' where id = p3_document;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('27: super admin reviewed a document directly'); end if;
    insert into public.documents (application_id, requirement_code, storage_path, original_filename, mime_type, size_bytes, sha256, uploaded_by)
    values (app_block7, 'vaccination_card', 'forged/path', 'x.pdf', 'application/pdf', 1, 'x', 'staff');
    v_fail := v_fail || E'\n  - ' || ('27: super admin inserted a document row directly');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('27: registration write refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.documents where id = p3_document;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('27 control: admissions staff cannot read a document row'); end if;
    select count(*) into v_count from public.registrations where application_id = app_block7;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('27 control: admissions staff cannot read a registration'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('27 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 28. Receipts are finance's to read; what is owed is admissions' too;
  --     an assessor sees neither
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_finance);
    select count(*) into v_count from public.payments where id = p3_payment;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('28 control: finance cannot read payments'); end if;
    select count(*) into v_count from public.payment_requests where id = p3_request;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('28 control: finance cannot read payment requests'); end if;
    update public.bank_instructions set is_active = is_active where false;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('28 control: unexpected error as finance: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.payments where id = p3_payment;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('28: admissions staff can read payments'); end if;
    select count(*) into v_count from public.payment_requests where id = p3_request;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('28 control: admissions staff cannot see what is owed'); end if;
    insert into public.bank_instructions (currency, body_text) values ('ZAR', 'forged');
    v_fail := v_fail || E'\n  - ' || ('28: admissions staff wrote bank instructions');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('28: unexpected error as staff: ' || sqlerrm);
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_assessor);
    select count(*) into v_count from public.payments where id = p3_payment;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('28: assessor can read payments'); end if;
    select count(*) into v_count from public.payment_requests where id = p3_request;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('28: assessor can read payment requests'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('28: unexpected error as assessor: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 29. Agreements are published with templates.write; the document rule
  --     function answers by grade
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    perform public.publish_agreement_template('sec_forged', 'Forged', null, '<p>x</p>', true);
    v_fail := v_fail || E'\n  - ' || ('29: admissions staff published an agreement');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%permission_denied%' then
        v_fail := v_fail || E'\n  - ' || ('29: refused by "' || sqlerrm || '" rather than permission_denied');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    v_id := public.publish_agreement_template('sec_new', 'New agreement', null, '<p>x</p>', false);
    if v_id is null then v_fail := v_fail || E'\n  - ' || ('29 control: super admin could not publish an agreement'); end if;
    select count(*) into v_count from public.agreement_templates where key = 'sec_new' and is_active;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('29 control: published agreement is not the one active version'); end if;
    select count(*) into v_count from public.required_document_codes(60);
    if v_count <> 4 then v_fail := v_fail || E'\n  - ' || ('29: required_document_codes(60) returned ' || v_count || ', expected 4'); end if;
    select count(*) into v_count from public.required_document_codes(10);
    if v_count <> 2 then v_fail := v_fail || E'\n  - ' || ('29: required_document_codes(10) returned ' || v_count || ', expected 2'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('29 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 30. Document requirements are settings.write to change, anyone's to read
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.document_requirements;
    if v_count < 5 then v_fail := v_fail || E'\n  - ' || ('30 control: staff cannot read document requirements'); end if;
    insert into public.document_requirements (code, label) values ('sec_forged', 'Forged');
    v_fail := v_fail || E'\n  - ' || ('30: admissions staff added a document requirement');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('30: refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    insert into public.document_requirements (code, label, required) values ('sec_extra', 'Extra', false);
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('30 control: super admin cannot add a document requirement: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 31. The campus administrator role is campus-scoped (guards the seed)
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    if not exists (select 1 from public.roles where code = 'campus_admin' and campus_scoped) then
      v_fail := v_fail || E'\n  - ' || ('31: campus_admin is not campus_scoped');
    end if;
    if exists (select 1 from public.roles where code in ('super_admin', 'admissions_manager') and campus_scoped) then
      v_fail := v_fail || E'\n  - ' || ('31: a head-office role is campus_scoped');
    end if;
  end;

  -- -------------------------------------------------------------------------
  -- 32. WhatsApp messages follow the application's campus and are the
  --     engine's to write
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_campus_admin);
    select count(*) into v_count from public.messages where id = p4_message;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('32: campus admin can see another campus''s WhatsApp message'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('32: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.messages where id = p4_message;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('32 control: admissions staff cannot read a message on their campus'); end if;
    update public.messages set status = 'read' where id = p4_message;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('32: staff updated a message directly'); end if;
    insert into public.messages (application_id, direction, provider, status, rendered_text)
    values (app_block7, 'out', 'dev', 'sent', 'forged');
    v_fail := v_fail || E'\n  - ' || ('32: staff inserted a message directly');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('32: refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 33. Message templates: anyone reads, templates.write edits
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.message_templates;
    if v_count < 5 then v_fail := v_fail || E'\n  - ' || ('33 control: staff cannot read message templates'); end if;
    update public.message_templates set is_active = true, meta_template_name = 'forged' where key = 'booking_confirmed';
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('33: admissions staff activated a WhatsApp template'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('33: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    update public.message_templates set meta_template_name = 'sec_named' where key = 'booking_confirmed';
    get diagnostics v_count = row_count;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('33 control: super admin cannot edit a WhatsApp template'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('33 control: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 34. Summaries follow the campus; nobody writes them by hand
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_campus_admin);
    select count(*) into v_count from public.application_summaries where application_id = app_block7;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('34: campus admin can see another campus''s summary'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('34: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    select count(*) into v_count from public.application_summaries where application_id = app_block7;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('34 control: super admin cannot read a summary'); end if;
    update public.application_summaries set paragraph = 'tampered' where application_id = app_block7;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('34: super admin edited a summary directly'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('34: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 35. Export columns are settings.write to change; export batches follow
  --     data.export and the campus
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.export_columns;
    if v_count < 10 then v_fail := v_fail || E'\n  - ' || ('35 control: staff cannot read export columns'); end if;
    update public.export_columns set is_active = true where source_path like 'medical.%';
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('35: admissions staff switched medical export columns on'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('35: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_assessor);
    select count(*) into v_count from public.student_exports where id = p4_export;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('35: an assessor can see export batches'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('35: unexpected error as assessor: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_campus_admin);
    select count(*) into v_count from public.student_exports where id = p4_export;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('35: campus admin can see another campus''s export batch'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('35: unexpected error as campus admin: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    select count(*) into v_count from public.student_exports where id = p4_export;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('35 control: super admin cannot see an export batch'); end if;
    insert into public.student_exports (campus_id, format, filename) values (c_block7, 'csv', 'forged.csv');
    v_fail := v_fail || E'\n  - ' || ('35: super admin inserted an export batch directly');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('35: batch insert refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 36. The service-role-only functions are not callable by any signed-in
  --     account, super admin included
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_admin);
    perform public.anonymise_application(app_retain);
    v_fail := v_fail || E'\n  - ' || ('36: super admin called anonymise_application');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('36: anonymise refused by "' || sqlerrm || '" rather than the execute grant');
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    select public.campus_dashboard_counts(c_block7) into v_json;
    v_fail := v_fail || E'\n  - ' || ('36: super admin called campus_dashboard_counts');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('36: campus counts refused by "' || sqlerrm || '" rather than the execute grant');
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    select public.mark_student_records_exported(array[]::uuid[], p4_export) into v_count;
    v_fail := v_fail || E'\n  - ' || ('36: super admin called mark_student_records_exported');
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('36: mark exported refused by "' || sqlerrm || '" rather than the execute grant');
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 37. Anonymisation removes the person and keeps the analytics row
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    perform public.anonymise_application(app_retain);
    select child_first_name into v_text from public.applications where id = app_retain;
    if v_text <> 'Removed' then v_fail := v_fail || E'\n  - ' || ('37: child name survives anonymisation'); end if;
    select count(*) into v_count from public.applications where id = app_retain and anonymised_at is not null and status is not null and campus_id = c_block7;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('37: the analytics row did not survive anonymisation'); end if;
    select email into v_text from public.contacts where id = c_retain;
    if v_text not like 'removed+%@invalid' then v_fail := v_fail || E'\n  - ' || ('37: contact email survives anonymisation'); end if;
    select count(*) into v_count from public.contacts where id = c_retain and mobile_normalised is not null;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('37: contact mobile survives anonymisation'); end if;
    select count(*) into v_count from public.notes where application_id = app_retain;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('37: notes survive anonymisation'); end if;
    select count(*) into v_count from public.access_tokens where application_id = app_retain;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('37: tokens survive anonymisation'); end if;
    -- The other family is untouched.
    select child_first_name into v_text from public.applications where id = app_block7;
    if v_text = 'Removed' then v_fail := v_fail || E'\n  - ' || ('37: anonymisation touched another application'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('37: unexpected error: ' || sqlerrm);
  end;

  -- -------------------------------------------------------------------------
  -- 38. Per-campus counts count only the campus; the dashboard has the new
  --     tiles; maintenance runs are the service role's
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    select public.campus_dashboard_counts(c_broadhurst) into v_json;
    if (v_json->>'unbooked_over_48h') is null or (v_json->>'parent_replies') is null then
      v_fail := v_fail || E'\n  - ' || ('38: campus_dashboard_counts is missing keys');
    end if;
    insert into public.tasks (application_id, campus_id, type, title, status) values (app_block7, c_block7, 'parent_replied', 'Sec reply', 'open');
    select public.campus_dashboard_counts(c_broadhurst) into v_json;
    if (v_json->>'parent_replies')::int <> 0 then v_fail := v_fail || E'\n  - ' || ('38: Broadhurst counts a Block 7 reply'); end if;
    select public.campus_dashboard_counts(c_block7) into v_json;
    if (v_json->>'parent_replies')::int < 1 then v_fail := v_fail || E'\n  - ' || ('38: Block 7 does not count its own reply'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('38: unexpected error: ' || sqlerrm);
  end;
  begin
    perform pg_temp.impersonate(u_admin);
    select public.dashboard_counts() into v_json;
    if (v_json->>'waitlist_places') is null or (v_json->>'parent_replies') is null then
      v_fail := v_fail || E'\n  - ' || ('38: dashboard_counts is missing the Phase 4 tiles');
    end if;
    select count(*) into v_count from public.maintenance_runs;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('38: staff can read maintenance runs'); end if;
  exception
    when insufficient_privilege then null;
    when others then v_fail := v_fail || E'\n  - ' || ('38: unexpected error as admin: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 39. The staff digest is a staff template with no parent links; a staff
  --     template is never sent to a parent by mistake (audience guards it)
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    select count(*) into v_count from public.email_templates
     where key = 'staff_digest' and is_active and audience = 'staff'
       and not exists (select 1 from unnest(allowed_variables) v where v like '%_link' and v <> 'console_link');
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('39: staff_digest is not a staff-only template without parent links'); end if;
    select count(*) into v_count from public.email_templates where audience = 'staff' and key <> 'staff_digest';
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('39: a parent template is marked as staff'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('39: unexpected error: ' || sqlerrm);
  end;

  -- -------------------------------------------------------------------------
  -- 40. Every Phase 4 automation ships switched off
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    select count(*) into v_count from public.settings
     where key in ('whatsapp_enabled', 'ai_extraction_enabled', 'ai_summary_enabled', 'waitlist_auto_promote', 'retention_enabled', 'digest_enabled')
       and value = 'false'::jsonb;
    if v_count <> 6 then v_fail := v_fail || E'\n  - ' || ('40: a Phase 4 switch is not seeded off (' || v_count || ' of 6)'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('40: unexpected error: ' || sqlerrm);
  end;

  -- -------------------------------------------------------------------------
  -- Verdict. Raise either way so the transaction rolls back.
  -- -------------------------------------------------------------------------
  if v_fail <> '' then
    raise exception 'SECURITY REGRESSIONS:%', v_fail;
  end if;
  raise exception 'ALL SECURITY CHECKS PASSED (rolled back)';
end
$$;
