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
  -- A bursar who works at one campus only. The payment policies used to reach
  -- campus by joining `applications`; they now read the denormalised column,
  -- and this is who proves that still holds.
  u_finance_bh uuid := gen_random_uuid();
  -- Management: read-only everywhere else, and the reason `tasks.write` had
  -- to be its own permission. Case 57.
  u_management uuid := gen_random_uuid();
  -- Case 54 builds its own admissions row: case 43 deletes app_block7.
  x_app uuid;
  x_offer uuid;
  x_acceptance uuid;
  x_request uuid;
  x_payment uuid;
  x_app2 uuid;
  -- Case 56 builds its own too, for the same reason.
  x_deferred uuid;
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
  -- Family CRM fixtures: a child enrolled at each campus.
  crm_student_block7 uuid;
  crm_student_broadhurst uuid;
  s_session uuid;
  s_empty uuid;
  v_count int;
  v_id uuid;
  v_id2 uuid;
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
    (u_campus_mgr, 'sec-campus-mgr@test.invalid'),
    (u_finance_bh, 'sec-finance-bh@test.invalid'),
    (u_management, 'sec-management@test.invalid');
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
    (u_campus_mgr, 'Sec Campus Manager', 'sec-campus-mgr@test.invalid', true),
    (u_finance_bh, 'Sec Finance Broadhurst', 'sec-finance-bh@test.invalid', true),
    (u_management, 'Sec Management', 'sec-management@test.invalid', true);
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
    (u_campus_mgr, 'admissions_manager'),
    (u_finance_bh, 'finance'),
    (u_management, 'management')
  ) as x(u, code) join public.roles r on r.code = x.code;

  select id into c_block7 from public.campuses where code = 'block7';
  select id into c_broadhurst from public.campuses where code = 'broadhurst';
  select id into g_stage4 from public.grades where code = 'stage_4';
  select id into i_intake from public.intakes where is_open order by starts_on limit 1;
  if c_block7 is null or c_broadhurst is null or g_stage4 is null or i_intake is null then
    raise exception 'SUITE BROKEN: seed data missing (campuses/grades/intakes)';
  end if;

  insert into public.staff_campuses (staff_id, campus_id) values
    (u_campus_admin, c_broadhurst), (u_campus_mgr, c_broadhurst), (u_finance_bh, c_broadhurst);

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
  -- Two enrolled children, one per campus, built the way the engine builds
  -- them: under the service role, from a family the contact trigger minted.
  insert into public.students (
    family_id, student_code, legal_first_name, legal_last_name,
    date_of_birth, current_campus_id, current_grade_id
  )
  select c.family_id, public.next_student_code(), 'Sec', 'Block7',
         date '2017-04-15', c_block7, g_stage4
    from public.applications a join public.contacts c on c.id = a.contact_id
   where a.id = app_block7
  returning id into crm_student_block7;

  insert into public.students (
    family_id, student_code, legal_first_name, legal_last_name,
    date_of_birth, current_campus_id, current_grade_id
  )
  select c.family_id, public.next_student_code(), 'Sec', 'Broadhurst',
         date '2017-04-15', c_broadhurst, g_stage4
    from public.applications a join public.contacts c on c.id = a.contact_id
   where a.id = app_broadhurst
  returning id into crm_student_broadhurst;

  insert into public.enrolments (student_id, academic_year_id, campus_id, grade_id, status)
  values (crm_student_block7, p2_year, c_block7, g_stage4, 'active'),
         (crm_student_broadhurst, p2_year, c_broadhurst, g_stage4, 'active');

  if p2_competency is null or p2_offer_template is null or p2_year is null
     or crm_student_block7 is null or crm_student_broadhurst is null then
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
    -- Birth certificate, vaccination card, parent ID for every grade; school
    -- report and transfer certificate from Stage 1 up.
    select count(*) into v_count from public.required_document_codes(60);
    if v_count <> 5 then v_fail := v_fail || E'\n  - ' || ('29: required_document_codes(60) returned ' || v_count || ', expected 5'); end if;
    select count(*) into v_count from public.required_document_codes(10);
    if v_count <> 3 then v_fail := v_fail || E'\n  - ' || ('29: required_document_codes(10) returned ' || v_count || ', expected 3'); end if;
    -- The parent's own ID is asked of everybody, whatever the grade.
    if not exists (select 1 from public.required_document_codes(10) c where c = 'parent_id')
       or not exists (select 1 from public.required_document_codes(60) c where c = 'parent_id') then
      v_fail := v_fail || E'\n  - ' || '29: parent_id is not required at every grade';
    end if;
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
  -- 32b. The delivery trail inherits the message's campus, and nobody may
  --      rewrite it
  -- -------------------------------------------------------------------------
  -- `message_events_select` delegates to `messages` rather than repeating the
  -- campus check, which is the right way round — one rule instead of two that
  -- drift apart. That is only safe if the subquery really is subject to the
  -- messages policy, so this checks it in both directions.
  insert into public.message_events (message_id, status, source, detail)
  values (p4_message, 'delivered', 'webhook', 'sec trail');
  begin
    perform pg_temp.impersonate(u_campus_admin);
    select count(*) into v_count from public.message_events where message_id = p4_message;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('32b: campus admin can see another campus''s delivery trail'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('32b: unexpected error: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.message_events where message_id = p4_message;
    if v_count <> 1 then v_fail := v_fail || E'\n  - ' || ('32b control: admissions staff cannot read the trail on their campus'); end if;
    -- Append-only: a trail staff can edit is not a trail.
    update public.message_events set detail = 'rewritten' where message_id = p4_message;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('32b: staff rewrote the delivery trail'); end if;
    delete from public.message_events where message_id = p4_message;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('32b: staff deleted from the delivery trail'); end if;
    insert into public.message_events (message_id, status, source)
    values (p4_message, 'read', 'webhook');
    v_fail := v_fail || E'\n  - ' || ('32b: staff forged a delivery receipt');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('32b: refused by "' || sqlerrm || '" rather than RLS');
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
    -- The staff audience is a closed list: a parent template marked staff
    -- would be sent to a colleague's address with a parent's magic link in it.
    select count(*) into v_count from public.email_templates
     where audience = 'staff' and key not in ('staff_digest', 'staff_invite');
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('39: a parent template is marked as staff'); end if;
    -- Whatever a staff template links to, it is never a parent's link.
    select count(*) into v_count from public.email_templates
     where audience = 'staff'
       and exists (select 1 from unnest(allowed_variables) v where v like '%_link' and v not in ('console_link', 'invite_link'));
    if v_count <> 0 then v_fail := v_fail || E'\n  - ' || ('39: a staff template carries a parent link'); end if;
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
  -- 41. School closures: any staff member reads them, only settings.write
  --     changes them, and the 2026 calendar is seeded
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.impersonate(u_staff);
    select count(*) into v_count from public.school_closures;
    if v_count < 10 then v_fail := v_fail || E'\n  - ' || ('41: staff cannot read the seeded closures (' || v_count || ')'); end if;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('41: reading closures as staff failed: ' || sqlerrm);
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_staff);
    insert into public.school_closures (starts_on, ends_on, label, created_by) values ('2030-01-01', '2030-01-02', 'Sec closure', u_staff);
    v_fail := v_fail || E'\n  - ' || ('41: admissions staff inserted a closure');
  exception
    when insufficient_privilege then null;
    when others then
      if sqlerrm not like '%row-level security%' then
        v_fail := v_fail || E'\n  - ' || ('41: refused by "' || sqlerrm || '" rather than RLS');
      end if;
  end;
  perform pg_temp.service();
  begin
    perform pg_temp.impersonate(u_admin);
    insert into public.school_closures (starts_on, ends_on, label, created_by) values ('2030-01-01', '2030-01-02', 'Sec closure', u_admin) returning id into v_id;
    delete from public.school_closures where id = v_id;
  exception when others then
    v_fail := v_fail || E'\n  - ' || ('41 control: settings.write cannot manage closures: ' || sqlerrm);
  end;
  perform pg_temp.service();

  -- -------------------------------------------------------------------------
  -- 42. Managing people is not the same as deciding what a role may do.
  --     An admissions manager holds `staff.write`. That must let them invite
  --     and staff-up colleagues, and must NOT let them rewrite the matrix,
  --     promote themselves, or hand out more than they hold — each of those
  --     is a way of turning `staff.write` into `admin`.
  -- -------------------------------------------------------------------------
  declare
    r_super uuid;
    r_campus uuid;
    r_manager uuid;
  begin
    select id into r_super from public.roles where code = 'super_admin';
    select id into r_campus from public.roles where code = 'campus_admin';
    select id into r_manager from public.roles where code = 'admissions_manager';

    -- The manager fixture must actually hold staff.write for the attacks
    -- below to mean anything.
    if not exists (
      select 1 from public.role_permissions
      where role_id = r_manager and permission_code = 'staff.write'
    ) then
      v_fail := v_fail || E'\n  - ' || '42: the admissions manager no longer holds staff.write';
    end if;

    -- Attack: rewrite the matrix.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      insert into public.role_permissions (role_id, permission_code) values (r_manager, 'admin');
      v_fail := v_fail || E'\n  - ' || '42: an admissions manager granted their own role the admin permission';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('42: matrix insert refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Attack: strip a permission from the matrix.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      delete from public.role_permissions where role_id = r_super;
      if found then
        v_fail := v_fail || E'\n  - ' || '42: an admissions manager emptied the super administrator role';
      end if;
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('42: matrix delete refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Attack: promote yourself.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      insert into public.staff_roles (staff_id, role_id) values (u_campus_mgr, r_super);
      v_fail := v_fail || E'\n  - ' || '42: an admissions manager made themselves a super administrator';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('42: self-promotion refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Attack: promote somebody else, then sign in as them. Same escalation,
    -- one step longer.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      insert into public.staff_roles (staff_id, role_id) values (u_staff, r_super);
      v_fail := v_fail || E'\n  - ' || '42: an admissions manager made a colleague a super administrator';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('42: granting above the ceiling refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Attack: demote the super administrator, locking the school out.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      delete from public.staff_roles where staff_id = u_admin and role_id = r_super;
      if found then
        v_fail := v_fail || E'\n  - ' || '42: an admissions manager demoted the super administrator';
      end if;
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('42: demotion refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Control: the legitimate case still works. A campus administrator is
    -- entirely within an admissions manager's own ceiling, so handing it to a
    -- colleague is exactly what `staff.write` is for.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      insert into public.staff_roles (staff_id, role_id) values (u_noroles, r_campus);
      delete from public.staff_roles where staff_id = u_noroles and role_id = r_campus;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('42 control: an admissions manager cannot staff up a colleague: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- Control: a super administrator still edits the matrix.
    begin
      perform pg_temp.impersonate(u_admin);
      insert into public.role_permissions (role_id, permission_code) values (r_campus, 'analytics.read');
      delete from public.role_permissions where role_id = r_campus and permission_code = 'analytics.read';
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('42 control: a super administrator cannot edit the matrix: ' || sqlerrm);
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 43. Deleting an applicant: the permission, the grant, and what is left
  -- -------------------------------------------------------------------------
  declare
    v_before int;
    v_audit int;
  begin
    -- The permission belongs to the super administrator and to nobody else by
    -- default. An admissions officer with applications.write must not have it.
    select count(*) into v_count
      from public.role_permissions rp
      join public.roles r on r.id = rp.role_id
     where rp.permission_code = 'applications.delete' and r.code <> 'super_admin';
    if v_count <> 0 then
      v_fail := v_fail || E'\n  - ' || '43: applications.delete is granted to a role other than super_admin';
    end if;

    -- Attack: call the function as a signed-in super administrator. It is
    -- service role only; the console checks the permission and then uses the
    -- admin client, so nothing signed in should ever reach it.
    begin
      perform pg_temp.impersonate(u_admin);
      perform public.delete_application(app_block7, 'attack', u_admin, 'attack');
      v_fail := v_fail || E'\n  - ' || '43: super admin called delete_application';
    exception
      when insufficient_privilege then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('43: delete_application refused by "' || sqlerrm || '" rather than the execute grant');
    end;
    perform pg_temp.service();

    -- The escape hatch is for deleting, and only for deleting: a decision
    -- still cannot be rewritten.
    begin
      update public.admission_decisions set override_reason = 'rewritten' where application_id = app_block7;
      v_fail := v_fail || E'\n  - ' || '43: an admission decision was updated';
    exception when others then
      if sqlerrm not like '%append-only%' then
        v_fail := v_fail || E'\n  - ' || ('43: decision update refused by "' || sqlerrm || '" rather than the append-only trigger');
      end if;
    end;

    -- Control: the service role deletes, everything attached goes with it,
    -- and the audit line naming what was destroyed stays behind.
    begin
      select count(*) into v_before from public.admission_decisions where application_id = app_block7;
      if v_before = 0 then
        v_fail := v_fail || E'\n  - ' || '43: the fixture has nothing attached, so the cascade proves nothing';
      end if;
      perform public.delete_application(app_block7, 'a duplicate', u_admin, 'admin@example.com');

      select count(*) into v_count from public.applications where id = app_block7;
      if v_count <> 0 then v_fail := v_fail || E'\n  - ' || '43: the application survived the delete'; end if;
      select count(*) into v_count from public.registrations where application_id = app_block7;
      if v_count <> 0 then v_fail := v_fail || E'\n  - ' || '43: the registration survived the delete'; end if;
      select count(*) into v_count from public.documents where application_id = app_block7;
      if v_count <> 0 then v_fail := v_fail || E'\n  - ' || '43: documents survived the delete'; end if;
      select count(*) into v_count from public.payments where application_id = app_block7;
      if v_count <> 0 then v_fail := v_fail || E'\n  - ' || '43: payments survived the delete'; end if;
      select count(*) into v_count from public.admission_decisions where application_id = app_block7;
      if v_count <> 0 then v_fail := v_fail || E'\n  - ' || '43: admission decisions survived the delete'; end if;
      select count(*) into v_audit from public.audit_log
       where application_id = app_block7 and action = 'application.deleted';
      if v_audit <> 1 then v_fail := v_fail || E'\n  - ' || '43: no audit line was left behind'; end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('43: the service role could not delete an applicant: ' || sqlerrm);
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 44. Ed-admin stage names: settings.write to change, readable by staff
  -- -------------------------------------------------------------------------
  begin
    -- Attack: an admissions officer renames a stage in the other system.
    -- Every enrolled child at that campus would then import into the wrong
    -- grade, or into none, which is a data change dressed as a label.
    begin
      perform pg_temp.impersonate(u_staff);
      update public.campus_grades set external_grade_code = 'Stage1-HLA' where campus_id = c_block7;
      if found then
        v_fail := v_fail || E'\n  - ' || '44: an admissions officer renamed an Ed-admin stage';
      end if;
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('44: the rename was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Control: an administrator sets one, and any signed-in staff member can
    -- read it — the export needs it and runs as the person downloading.
    begin
      perform pg_temp.impersonate(u_admin);
      update public.campus_grades set external_grade_code = 'Stage1-HPS' where campus_id = c_block7;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('44 control: an administrator cannot set a stage name: ' || sqlerrm);
    end;
    perform pg_temp.service();
    begin
      perform pg_temp.impersonate(u_staff);
      select count(*) into v_count from public.campus_grades where external_grade_code is not null;
      if v_count = 0 then
        v_fail := v_fail || E'\n  - ' || '44: staff cannot read the Ed-admin stage names the export needs';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('44: reading the stage names failed: ' || sqlerrm);
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 45. A student is campus-scoped on their own row, not through a funnel
  -- -------------------------------------------------------------------------
  begin
    -- Attack: a manager limited to Broadhurst reads the register. A student
    -- outlives their application, so this policy asks the student's own
    -- campus rather than reaching through `applications`. If that column and
    -- `can_access_campus` ever disagree, every campus sees every child.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.students where id = crm_student_block7;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '45: a Broadhurst manager read a Block 7 student';
      end if;
      select count(*) into v_count from public.enrolments where campus_id = c_block7;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '45: a Broadhurst manager read a Block 7 enrolment';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('45: reading the register failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- Control: their own campus's child is there, or the policy says nothing.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.students where id = crm_student_broadhurst;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '45 control: a Broadhurst manager cannot read their own student';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('45 control: reading their own student failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- Attack: a content author has no business in the register at all.
    begin
      perform pg_temp.impersonate(u_author);
      select count(*) into v_count from public.students;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '45: a content author read the student register';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('45: the author read failed unexpectedly: ' || sqlerrm);
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 46. Nobody types a child straight into the register
  -- -------------------------------------------------------------------------
  begin
    -- Attack: an admissions officer inserts a student by hand, skipping the
    -- registration, the documents and the person who checked them. There is
    -- no insert policy on `students`; the engine writes them at enrolment.
    begin
      perform pg_temp.impersonate(u_staff);
      insert into public.students (
        family_id, student_code, legal_first_name, legal_last_name,
        date_of_birth, current_campus_id
      )
      select family_id, 'HBS-S-99999', 'Forged', 'Child', date '2017-01-01', c_block7
        from public.students where id = crm_student_block7;
      v_fail := v_fail || E'\n  - ' || '46: an admissions officer inserted a student';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('46: the insert was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 47. Retention does not erase an enrolled child
  -- -------------------------------------------------------------------------
  begin
    -- Attack: the retention sweep reaches an application a child was enrolled
    -- from. Anonymising it would delete the registration, the documents and
    -- the agreements the family's record is still made of.
    --
    -- Two fresh applications, because check 43 deletes app_block7 and the
    -- earlier ones carry a journey these two do not need.
    perform pg_temp.service();
    select application_id into v_id from public.create_application(
      'Sec','Retention','sec-retention-a@test.invalid','sec-retention-a@test.invalid',null,null,
      'Child','R','2017-04-15', c_block7, g_stage4, g_stage4, i_intake, 'assessment');
    update public.students set origin_application_id = v_id where id = crm_student_block7;
    begin
      perform public.anonymise_application(v_id);
      v_fail := v_fail || E'\n  - ' || '47: an enrolled child''s application was anonymised';
    exception when others then
      if sqlerrm <> 'application_enrolled' then
        v_fail := v_fail || E'\n  - ' || ('47: refused by "' || sqlerrm || '" rather than application_enrolled');
      end if;
    end;
    perform pg_temp.service();

    -- Control: an application nobody was enrolled from still anonymises.
    begin
      select application_id into v_id from public.create_application(
        'Sec','Retention','sec-retention-b@test.invalid','sec-retention-b@test.invalid',null,null,
        'Child','S','2017-04-15', c_block7, g_stage4, g_stage4, i_intake, 'assessment');
      perform public.anonymise_application(v_id);
      select count(*) into v_count from public.applications
       where id = v_id and anonymised_at is not null;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '47 control: the application was not anonymised';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('47 control: anonymising an ordinary application failed: ' || sqlerrm);
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 48. A magic link names exactly one subject, and the purpose decides which
  -- -------------------------------------------------------------------------
  begin
    -- A family link reaches every child in the family, so a token that named
    -- both — or a `payment` purpose pointed at a family — would be a way to
    -- widen one link into another. The database refuses the shapes rather
    -- than trusting whichever route minted it.
    perform pg_temp.service();

    begin
      insert into public.access_tokens (application_id, family_id, purpose, token_hash, expires_at)
      select app_broadhurst, s.family_id, 'family', 'sec-both', now() + interval '1 day'
        from public.students s where s.id = crm_student_broadhurst;
      v_fail := v_fail || E'\n  - ' || '48: a token named an application and a family at once';
    exception when check_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('48: the both-subjects insert failed with "' || sqlerrm || '"');
    end;

    begin
      insert into public.access_tokens (application_id, family_id, purpose, token_hash, expires_at)
      values (null, null, 'family', 'sec-neither', now() + interval '1 day');
      v_fail := v_fail || E'\n  - ' || '48: a token named no subject at all';
    exception when check_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('48: the no-subject insert failed with "' || sqlerrm || '"');
    end;

    begin
      insert into public.access_tokens (application_id, family_id, purpose, token_hash, expires_at)
      select null, s.family_id, 'payment', 'sec-wrong-purpose', now() + interval '1 day'
        from public.students s where s.id = crm_student_broadhurst;
      v_fail := v_fail || E'\n  - ' || '48: a funnel purpose was pointed at a family';
    exception when check_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('48: the wrong-purpose insert failed with "' || sqlerrm || '"');
    end;

    -- Control: the two shapes that are meant to work.
    begin
      insert into public.access_tokens (application_id, family_id, purpose, token_hash, expires_at)
      select null, s.family_id, 'reenrolment', 'sec-family-ok', now() + interval '1 day'
        from public.students s where s.id = crm_student_broadhurst;
      insert into public.access_tokens (application_id, family_id, purpose, token_hash, expires_at)
      values (app_broadhurst, null, 'payment', 'sec-app-ok', now() + interval '1 day');
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('48 control: a valid token was refused: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- And a family link is visible to staff who may see one of its children,
    -- but not to a manager at another campus.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.access_tokens where token_hash = 'sec-family-ok';
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '48: a Broadhurst manager cannot see their own family''s link';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('48: reading the family link failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    begin
      perform pg_temp.impersonate(u_author);
      select count(*) into v_count from public.access_tokens where token_hash = 'sec-family-ok';
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '48: a content author read a family link';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('48: the author read failed unexpectedly: ' || sqlerrm);
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 49. A re-enrolment round is campus-scoped, and nobody hand-picks the board
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    insert into public.reenrolment_cycles (intake_id, campus_id, name, opens_on, closes_on, status)
    values (i_intake, c_block7, 'Sec round', current_date, current_date + 30, 'open')
    returning id into v_id;
    insert into public.reenrolment_responses (cycle_id, student_id, campus_id)
    values (v_id, crm_student_block7, c_block7);

    -- Attack: a manager limited to Broadhurst reads Block 7's board. Who is
    -- leaving is exactly the kind of thing a campus does not share.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.reenrolment_responses where cycle_id = v_id;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '49: a Broadhurst manager read a Block 7 re-enrolment board';
      end if;
      select count(*) into v_count from public.reenrolment_cycles where id = v_id;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '49: a Broadhurst manager read a Block 7 round';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('49: reading the board failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- Attack: an admissions officer adds a line to the board by hand. The
    -- board is every child in scope, written by `open_reenrolment_cycle`, or
    -- it is not a count anyone can plan around.
    begin
      perform pg_temp.impersonate(u_staff);
      insert into public.reenrolment_responses (cycle_id, student_id, campus_id)
      values (v_id, crm_student_broadhurst, c_broadhurst);
      v_fail := v_fail || E'\n  - ' || '49: an admissions officer added a line to a board';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('49: the insert was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Attack: an officer without `reenrolment.write` opens a round, which
    -- would mail every family at a campus at once.
    begin
      perform pg_temp.impersonate(u_staff);
      insert into public.reenrolment_cycles (intake_id, campus_id, name, opens_on, closes_on)
      values (i_intake, c_block7, 'Forged round', current_date, current_date + 30);
      v_fail := v_fail || E'\n  - ' || '49: an admissions officer opened a re-enrolment round';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('49: the round insert was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Control: an administrator sees the board and can record an answer.
    begin
      perform pg_temp.impersonate(u_admin);
      select count(*) into v_count from public.reenrolment_responses where cycle_id = v_id;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '49 control: an administrator cannot read the board';
      end if;
      update public.reenrolment_responses
         set intent = 'returning', answered_at = now(), answered_by = 'staff'
       where cycle_id = v_id;
      if not found then
        v_fail := v_fail || E'\n  - ' || '49 control: an administrator cannot record an answer';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('49 control: working the board failed: ' || sqlerrm);
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 50. A checklist is campus-scoped, and the list itself is a settings change
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    insert into public.student_onboarding_items (student_id, campus_id, step_code)
    values (crm_student_block7, c_block7, 'welcome_read');

    -- Attack: a manager limited to Broadhurst reads Block 7's checklists.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.student_onboarding_items
       where student_id = crm_student_block7;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '50: a Broadhurst manager read a Block 7 checklist';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('50: reading the checklist failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- Attack: an officer adds an item to one child's checklist by hand. The
    -- checklist is the active list or it is not the same list as everyone
    -- else's, and a board built from hand-picked rows counts nothing.
    begin
      perform pg_temp.impersonate(u_staff);
      insert into public.student_onboarding_items (student_id, campus_id, step_code)
      values (crm_student_broadhurst, c_broadhurst, 'uniform');
      v_fail := v_fail || E'\n  - ' || '50: an admissions officer added a checklist item';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('50: the insert was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Attack: an officer rewrites what every family is asked for. Editing the
    -- list is a settings change, like the document requirements beside it.
    begin
      perform pg_temp.impersonate(u_staff);
      update public.onboarding_steps set label = 'Forged' where code = 'uniform';
      if found then
        v_fail := v_fail || E'\n  - ' || '50: an admissions officer rewrote the checklist';
      end if;
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('50: the edit was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Control: an officer may tick an item off on a family's behalf, and an
    -- administrator may change the list.
    begin
      perform pg_temp.impersonate(u_staff);
      update public.student_onboarding_items set status = 'done'
       where student_id = crm_student_block7;
      if not found then
        v_fail := v_fail || E'\n  - ' || '50 control: an officer cannot tick an item off';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('50 control: ticking an item off failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    begin
      perform pg_temp.impersonate(u_admin);
      update public.onboarding_steps set label = 'Uniform sizes' where code = 'uniform';
      if not found then
        v_fail := v_fail || E'\n  - ' || '50 control: an administrator cannot change the list';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('50 control: changing the list failed: ' || sqlerrm);
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 51. A task about a child is campus-scoped, and staff cannot forge one
  -- -------------------------------------------------------------------------
  begin
    -- Onboarding work happens after the application is terminal, so these
    -- tasks carry `student_id` and no application at all. `tasks_select`
    -- scopes on `tasks.campus_id` rather than joining through the
    -- application, which is what makes that safe — this is the check that it
    -- really is.
    perform pg_temp.service();
    insert into public.tasks (student_id, campus_id, type, title, details)
    values (crm_student_block7, c_block7, 'onboarding_first_day', 'Sec starter', 'sec');

    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.tasks
       where student_id = crm_student_block7 and type = 'onboarding_first_day';
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '51: a Broadhurst manager read a Block 7 child''s task';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('51: reading the task failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    begin
      perform pg_temp.impersonate(u_staff);
      select count(*) into v_count from public.tasks
       where student_id = crm_student_block7 and type = 'onboarding_first_day';
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '51 control: Block 7 staff cannot read their own child''s task';
      end if;
      -- The insert policy pins the author; a task the system is supposed to
      -- have raised must not be forgeable as one.
      insert into public.tasks (student_id, campus_id, type, title, created_by_type)
      values (crm_student_block7, c_block7, 'onboarding_first_day', 'Forged', 'system');
      v_fail := v_fail || E'\n  - ' || '51: staff inserted a system task';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('51: refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- A task about nothing is a task nobody can act on.
    begin
      insert into public.tasks (type, title) values ('orphan', 'No subject');
      v_fail := v_fail || E'\n  - ' || '51: a task was created with neither an application nor a child';
    exception when check_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('51: the no-subject insert failed with "' || sqlerrm || '"');
    end;
  end;

  -- -------------------------------------------------------------------------
  -- 52. The onboarding journey's record follows the child
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    insert into public.student_journey_messages (student_id, step)
    values (crm_student_block7, 'welcome');

    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.student_journey_messages
       where student_id = crm_student_block7;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '52: a Broadhurst manager saw what a Block 7 family was sent';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('52: reading the journey failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    begin
      perform pg_temp.impersonate(u_staff);
      select count(*) into v_count from public.student_journey_messages
       where student_id = crm_student_block7;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '52 control: Block 7 staff cannot see what their own family was sent';
      end if;
      -- Written by the sweep alone. Staff marking a family as welcomed would
      -- silently stop the welcome ever being sent.
      insert into public.student_journey_messages (student_id, step)
      values (crm_student_block7, 'first_day');
      v_fail := v_fail || E'\n  - ' || '52: staff wrote to the journey record';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('52: refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- One row per moment: the unique key is what stops a redelivered sweep
    -- welcoming the same family twice.
    begin
      insert into public.student_journey_messages (student_id, step)
      values (crm_student_block7, 'welcome');
      v_fail := v_fail || E'\n  - ' || '52: the same moment was recorded twice for one child';
    exception when unique_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('52: the duplicate insert failed with "' || sqlerrm || '"');
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 53. The extras catalogue, and what a family ordered
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();
    insert into public.optional_items (campus_id, code, label, amount_minor, currency)
    values (c_block7, 'sec_pack', 'Sec stationery pack', 25000, 'BWP')
    returning id into v_id;
    insert into public.student_optional_selections
      (student_id, item_id, campus_id, unit_amount_minor, currency)
    values (crm_student_block7, v_id, c_block7, 25000, 'BWP');

    -- The catalogue is not secret — any signed-in member of staff may read it,
    -- the same as the message templates. What a *family bought* is not.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.optional_items where id = v_id;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '53 control: staff cannot read the catalogue';
      end if;
      select count(*) into v_count from public.student_optional_selections
       where student_id = crm_student_block7;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '53: a Broadhurst manager saw what a Block 7 family ordered';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('53: reading failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    begin
      perform pg_temp.impersonate(u_staff);
      select count(*) into v_count from public.student_optional_selections
       where student_id = crm_student_block7;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '53 control: Block 7 staff cannot see their own family''s order';
      end if;

      -- An order nobody placed is an invoice nobody agreed to. Families order
      -- for themselves, through the service role and `lib/family/`.
      insert into public.student_optional_selections
        (student_id, item_id, campus_id, unit_amount_minor, currency)
      values (crm_student_broadhurst, v_id, c_broadhurst, 25000, 'BWP');
      v_fail := v_fail || E'\n  - ' || '53: staff placed an order on a family''s behalf';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('53: the order insert was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- Editing the catalogue is a settings change, like the fees beside it.
    begin
      perform pg_temp.impersonate(u_staff);
      update public.optional_items set amount_minor = 1 where id = v_id;
      if found then
        v_fail := v_fail || E'\n  - ' || '53: an admissions officer repriced the catalogue';
      end if;
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('53: the reprice was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- The currency is the campus's, set by trigger so a form cannot get it
    -- wrong. Potchefstroom charges rand whatever the insert claims.
    begin
      insert into public.optional_items (campus_id, code, label, amount_minor, currency)
      values (c_block7, 'sec_currency', 'Sec', 1000, 'ZAR') returning id into v_id2;
      select count(*) into v_count from public.optional_items
       where id = v_id2 and currency = 'BWP';
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '53: an item kept a currency that was not its campus''s';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('53: the currency trigger failed: ' || sqlerrm);
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 54. A payment request that names a child rather than an admission
  --
  -- The payment records used to require an application, an offer and an
  -- acceptance, and both read policies reached campus by joining
  -- `applications`. Relaxing that is a change to tables holding money, so
  -- every guard that replaced a NOT NULL is checked here: exactly one subject,
  -- a campus derived rather than accepted, and a bursar who still sees only
  -- their own campus under the rewritten policies.
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();

    -- Case 43 deletes app_block7 for real, so this case builds its own
    -- admissions row rather than reusing a fixture that is no longer there.
    select application_id into x_app from public.create_application(
      'Sec','Payer','sec-extras@test.invalid','sec-extras@test.invalid',null,null,
      'Child','X','2017-04-15', c_block7, g_stage4, g_stage4, i_intake, 'assessment');
    insert into public.offers (application_id, template_id, template_version, currency, rendered_html, terms_html, status)
    values (x_app, p2_offer_template, 1, 'BWP', '<p>offer</p>', '<p>terms</p>', 'accepted') returning id into x_offer;
    insert into public.offer_acceptances (application_id, offer_id, template_id, template_version, decision, terms_accepted, terms_hash, fees)
    values (x_app, x_offer, p2_offer_template, 1, 'accepted', true, 'sec-hash-x', '{}'::jsonb) returning id into x_acceptance;
    insert into public.payment_requests (application_id, offer_id, acceptance_id, currency, amount_minor, due_at)
    values (x_app, x_offer, x_acceptance, 'BWP', 750000, now() + interval '14 days') returning id into x_request;
    insert into public.payments (payment_request_id, method, provider, company_ref, status, amount_minor, currency)
    values (x_request, 'eft', 'bank', 'SEC-EFT-X', 'pending', 750000, 'BWP') returning id into x_payment;
    -- A second application with no open request, so the one-subject check is
    -- what refuses the insert below rather than the one-open-request index.
    select application_id into x_app2 from public.create_application(
      'Sec','Payer2','sec-extras2@test.invalid','sec-extras2@test.invalid',null,null,
      'Child','Y','2017-04-15', c_block7, g_stage4, g_stage4, i_intake, 'assessment');

    -- A request must name exactly one subject. Both is the dangerous one: it
    -- would make `kind`, the campus and every downstream branch ambiguous.
    begin
      insert into public.payment_requests
        (application_id, offer_id, acceptance_id, student_id, currency, amount_minor, due_at)
      values (x_app2, x_offer, x_acceptance, crm_student_block7, 'BWP', 1000, now() + interval '7 days');
      v_fail := v_fail || E'\n  - ' || '54: a payment request named both an application and a child';
    exception
      when check_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('54: the both-subjects insert failed with "' || sqlerrm || '"');
    end;
    perform pg_temp.service();

    -- And neither: money owed by nobody.
    begin
      insert into public.payment_requests (currency, amount_minor, due_at)
      values ('BWP', 1000, now() + interval '7 days');
      v_fail := v_fail || E'\n  - ' || '54: a payment request named no subject at all';
    exception
      when check_violation then null;
      -- The campus trigger fires first and raises its own complaint; either is
      -- a refusal, which is what matters.
      when others then
        if sqlerrm not like '%must resolve to a campus%' then
          v_fail := v_fail || E'\n  - ' || ('54: the no-subject insert failed with "' || sqlerrm || '"');
        end if;
    end;
    perform pg_temp.service();

    -- An admissions request still derives the application's own campus and
    -- still calls itself an admission, so nothing about the funnel moved.
    select count(*) into v_count from public.payment_requests r
     join public.applications a on a.id = r.application_id
     where r.id = x_request and r.campus_id = a.campus_id and r.kind = 'admission';
    if v_count <> 1 then
      v_fail := v_fail || E'\n  - ' || '54: an admissions request lost its campus or its kind';
    end if;

    -- A child's request: the campus and the kind are the trigger's, whatever
    -- the insert claimed. A forged campus is what the rewritten read policy
    -- would otherwise trust.
    begin
      insert into public.payment_requests (student_id, campus_id, kind, currency, amount_minor, due_at)
      values (crm_student_block7, c_broadhurst, 'admission', 'BWP', 25000, now() + interval '7 days')
      returning id into v_id;
      select count(*) into v_count from public.payment_requests
       where id = v_id and campus_id = c_block7 and kind = 'extras';
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '54: a request kept a campus or kind it was handed rather than its child''s';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('54: the extras request insert failed: ' || sqlerrm);
    end;

    -- One open request per child, the same rule the funnel has per
    -- application. Two would let a second checkout charge for lines the first
    -- one already covered.
    begin
      insert into public.payment_requests (student_id, currency, amount_minor, due_at)
      values (crm_student_block7, 'BWP', 25000, now() + interval '7 days');
      v_fail := v_fail || E'\n  - ' || '54: a child got a second open payment request';
    exception
      when unique_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('54: the second open request failed with "' || sqlerrm || '"');
    end;
    perform pg_temp.service();

    -- A payment's subject is its request's, overwritten rather than trusted.
    begin
      insert into public.payments
        (payment_request_id, application_id, campus_id, method, provider, company_ref, status, amount_minor, currency)
      values (v_id, x_app, c_broadhurst, 'online', 'dev', 'SEC-EXTRAS', 'pending', 25000, 'BWP')
      returning id into v_id2;
      select count(*) into v_count from public.payments
       where id = v_id2
         and student_id = crm_student_block7
         and application_id is null
         and campus_id = c_block7;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '54: a payment kept a subject or campus that was not its request''s';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('54: the extras payment insert failed: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- The rewritten policies, on the case they were rewritten for. A bursar at
    -- Broadhurst has finance.read and still must not see a Block 7 child's
    -- order or what was paid against it.
    begin
      perform pg_temp.impersonate(u_finance_bh);
      select count(*) into v_count from public.payment_requests where id = v_id;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '54: a Broadhurst bursar saw a Block 7 child''s extras request';
      end if;
      select count(*) into v_count from public.payments where id = v_id2;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '54: a Broadhurst bursar saw a Block 7 child''s extras payment';
      end if;
      -- And the admissions rows they were never allowed to see either, which
      -- is the regression the policy rewrite could have introduced.
      select count(*) into v_count from public.payment_requests where id = x_request;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '54: a Broadhurst bursar saw a Block 7 admissions request';
      end if;
      select count(*) into v_count from public.payments where id = x_payment;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '54: a Broadhurst bursar saw a Block 7 admissions payment';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('54: unexpected error as the Broadhurst bursar: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- The control: a head-office bursar sees both, so the cases above are
    -- campus scoping rather than the policy refusing everything.
    begin
      perform pg_temp.impersonate(u_finance);
      select count(*) into v_count from public.payment_requests where id = v_id;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '54 control: finance cannot read an extras request at all';
      end if;
      select count(*) into v_count from public.payments where id = v_id2;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '54 control: finance cannot read an extras payment at all';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('54 control: unexpected error as finance: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- An assessor has no business with money, extras included.
    begin
      perform pg_temp.impersonate(u_assessor);
      select count(*) into v_count from public.payment_requests where id = v_id;
      if v_count <> 0 then v_fail := v_fail || E'\n  - ' || '54: an assessor read an extras request'; end if;
      select count(*) into v_count from public.payments where id = v_id2;
      if v_count <> 0 then v_fail := v_fail || E'\n  - ' || '54: an assessor read an extras payment'; end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('54: unexpected error as assessor: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- Nobody writes money by hand, whatever its subject: requests are raised
    -- and settled by the engine under the service role.
    begin
      perform pg_temp.impersonate(u_finance);
      insert into public.payment_requests (student_id, currency, amount_minor, due_at)
      values (crm_student_broadhurst, 'BWP', 1, now() + interval '1 day');
      v_fail := v_fail || E'\n  - ' || '54: a bursar raised an extras request by hand';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('54: the by-hand request was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();
  end;

  -- -------------------------------------------------------------------------
  -- 55. The first-day morning list
  --
  -- `tasks_has_a_subject` was relaxed to admit a campus as a third kind of
  -- subject. That is only safe because `tasks_select` already scopes on
  -- `campus_id`, so this checks both halves: a task about nothing is still
  -- refused, and a campus-only task is visible to that campus and nowhere else.
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();

    -- A task about nothing at all is still refused.
    begin
      insert into public.tasks (type, title) values ('welcome_new_starters', 'Nobody''s task');
      v_fail := v_fail || E'\n  - ' || '55: a task with no subject at all was accepted';
    exception
      when check_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('55: the no-subject task failed with "' || sqlerrm || '"');
    end;
    perform pg_temp.service();

    insert into public.tasks (campus_id, type, title, details, due_at, priority)
    values (c_block7, 'welcome_new_starters', 'Block 7: 2 new starters today', 'Starting today: ...', '2027-01-12T05:00:00Z', 'high')
    returning id into v_id;

    -- One list per campus per morning, whatever the drain does. This is what
    -- stops two overlapping drains opening the same job twice.
    begin
      insert into public.tasks (campus_id, type, title, due_at)
      values (c_block7, 'welcome_new_starters', 'Block 7 again', '2027-01-12T05:00:00Z');
      v_fail := v_fail || E'\n  - ' || '55: a campus got two morning lists for the same day';
    exception
      when unique_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('55: the duplicate list failed with "' || sqlerrm || '"');
    end;
    perform pg_temp.service();

    -- The next morning is a different list, not a blocked one.
    begin
      insert into public.tasks (campus_id, type, title, due_at)
      values (c_block7, 'welcome_new_starters', 'Block 7 tomorrow', '2027-01-13T05:00:00Z');
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('55: the next day''s list was refused: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- A campus-only task obeys campus scope exactly as an application-scoped
    -- one does. The Broadhurst manager has applications.read and must not see
    -- Block 7's morning.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.tasks where id = v_id;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '55: a Broadhurst manager saw Block 7''s morning list';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('55: unexpected error as the Broadhurst manager: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- The control: head-office admissions staff see it, so the case above is
    -- campus scoping rather than the task being invisible to everyone.
    begin
      perform pg_temp.impersonate(u_staff);
      select count(*) into v_count from public.tasks where id = v_id;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '55 control: head-office staff cannot see a campus task at all';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('55 control: unexpected error as staff: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- The per-child half: a staff-owned step, so the board shows it and no
    -- parent is ever asked whether somebody greeted their child.
    select count(*) into v_count from public.onboarding_steps
     where code = 'welcomed_on_first_day' and owner = 'staff' and is_active and due_offset_days = 0;
    if v_count <> 1 then
      v_fail := v_fail || E'\n  - ' || '55: welcomed_on_first_day is missing, not staff-owned, or not due on the day';
    end if;
  end;

  -- -------------------------------------------------------------------------
  -- 56. Deferred, and why a family said no
  --
  -- `deferred` is the first status added to the constraint since it was
  -- written with every phase's statuses in it, and `withdrawn_reason_code` is
  -- the first column whose whole value is that it can only hold one of six
  -- things. Both are only worth anything if the database refuses what is not
  -- on the list — a typo'd status would sit in the pipeline in a column
  -- nothing draws, and an invented reason code would quietly become a
  -- category in the analytics.
  --
  -- The call the school promises to make is a task, so it obeys campus scope
  -- like every other task: a manager at one campus must not see another
  -- campus's deferred family, or the promise is kept by the wrong person.
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();

    select application_id into x_deferred from public.create_application(
      'Sec','Deferrer','sec-defer@test.invalid','sec-defer@test.invalid',null,null,
      'Child','Z','2017-04-15', c_block7, g_stage4, g_stage4, i_intake, 'assessment');

    -- The status is on the list.
    begin
      update public.applications
         set status = 'deferred', deferred_until = current_date + 30, deferred_reason = 'Moving house in March'
       where id = x_deferred;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('56: a deferred status was refused: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- And a near miss is not.
    begin
      update public.applications set status = 'defered' where id = x_deferred;
      v_fail := v_fail || E'\n  - ' || '56: a misspelt status was accepted';
    exception
      when check_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('56: the misspelt status failed with "' || sqlerrm || '"');
    end;
    perform pg_temp.service();

    -- A withdrawal reason has to be one of the six.
    begin
      update public.applications set withdrawn_reason_code = 'they_ghosted_us' where id = x_deferred;
      v_fail := v_fail || E'\n  - ' || '56: an invented withdrawal reason was accepted';
    exception
      when check_violation then null;
      when others then
        v_fail := v_fail || E'\n  - ' || ('56: the invented reason failed with "' || sqlerrm || '"');
    end;
    perform pg_temp.service();

    -- The control, so the case above is the list and not the column refusing
    -- everything: a real code, and null for the withdrawals that predate it.
    begin
      update public.applications set withdrawn_reason_code = 'fees' where id = x_deferred;
      update public.applications set withdrawn_reason_code = null where id = x_deferred;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('56 control: a valid withdrawal reason was refused: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- The call the school promised, on the owner's badge at the right campus.
    -- `apply_transition` fills `campus_id` from the application it is about
    -- (20260904120800_workflow_engine.sql), and that column is what
    -- `tasks_select` scopes on — a task carrying a null campus is visible to
    -- everyone with `applications.read`, by design, for the head-office ones.
    -- So this inserts it the way the engine would.
    insert into public.tasks (application_id, campus_id, type, title, due_at, priority)
    values (x_deferred, c_block7, 'deferral_due', 'Call about Child Z', now() + interval '30 days', 'normal')
    returning id into v_id;

    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.tasks where id = v_id;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '56: a Broadhurst manager saw Block 7''s deferred family';
      end if;
      select count(*) into v_count from public.applications where id = x_deferred;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '56: a Broadhurst manager saw a deferred Block 7 application';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('56: unexpected error as the Broadhurst manager: ' || sqlerrm);
    end;
    perform pg_temp.service();

    begin
      perform pg_temp.impersonate(u_staff);
      select count(*) into v_count from public.tasks where id = v_id;
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '56 control: head-office staff cannot see the deferral task at all';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('56 control: unexpected error as staff: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- The follow-up exists as a pair, and the WhatsApp half is inactive until
    -- somebody pastes the approved id in — the same state every companion
    -- starts in, and what stops a template sending with no wording behind it.
    --
    -- The "active" half of that cannot be broken from here: `message_templates`
    -- refuses an active row with no provider id, checked by trying. What this
    -- catches is the half that can — a migration that ships the email and
    -- forgets the companion, which is how `what_to_expect` went missing for
    -- real families until the coverage check was written.
    select count(*) into v_count from public.email_templates
     where key = 'deferred_follow_up' and is_active and audience = 'parent';
    if v_count <> 1 then
      v_fail := v_fail || E'\n  - ' || '56: the deferral follow-up email is missing or not parent-facing';
    end if;
    select count(*) into v_count from public.message_templates
     where key = 'deferred_follow_up' and not is_active;
    if v_count <> 1 then
      v_fail := v_fail || E'\n  - ' || '56: the deferral companion is missing, or active before it was approved';
    end if;
  end;

  -- -------------------------------------------------------------------------
  -- 57. A task somebody writes, and who may tick it off
  --
  -- `tasks_insert` used to ask for `applications.write`. Management holds no
  -- write permission at all, so letting them set a task by reusing that one
  -- would have handed them the applicant record with it. `tasks.write` exists
  -- to be the narrower answer, and this is what says it stayed narrow: the
  -- role that got the grant can write a task, and a role with
  -- `applications.write` but no grant cannot.
  --
  -- The other half is completion. A task is given to somebody; if the policy
  -- had kept asking for `applications.write`, the person it was given to
  -- would have been refused by the database when they ticked it off.
  -- -------------------------------------------------------------------------
  begin
    perform pg_temp.service();

    -- Management may write one.
    begin
      perform pg_temp.impersonate(u_management);
      insert into public.tasks (campus_id, type, title, priority, assignee_staff_id, created_by_type, created_by)
      values (c_block7, 'staff_task', 'Chase the Block 7 fire certificate', 'normal', u_management, 'staff', u_management)
      returning id into v_id;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('57: Management could not write a task: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- Admissions staff hold `applications.write` and not `tasks.write`, so
    -- the permission is doing the work rather than riding on the old one.
    begin
      perform pg_temp.impersonate(u_staff);
      insert into public.tasks (campus_id, type, title, created_by_type, created_by)
      values (c_block7, 'staff_task', 'Admissions staff should not manage to write this', 'staff', u_staff);
      v_fail := v_fail || E'\n  - ' || '57: a role without tasks.write wrote a task anyway';
    exception
      when insufficient_privilege then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('57: the unpermitted insert was refused by "' || sqlerrm || '" rather than RLS');
        end if;
    end;
    perform pg_temp.service();

    -- A task still has to be about something. This is what stops a staff task
    -- with no campus, which would also be a task outside every campus scope.
    begin
      perform pg_temp.impersonate(u_management);
      insert into public.tasks (type, title, created_by_type, created_by)
      values ('staff_task', 'A task about nothing', 'staff', u_management);
      v_fail := v_fail || E'\n  - ' || '57: a staff task with no subject was accepted';
    exception
      when check_violation then null;
      when others then
        if sqlerrm not like '%row-level security%' then
          v_fail := v_fail || E'\n  - ' || ('57: the no-subject task failed with "' || sqlerrm || '"');
        end if;
    end;
    perform pg_temp.service();

    -- The person it was given to can tick it off, holding no write permission
    -- of any other kind.
    begin
      perform pg_temp.impersonate(u_management);
      update public.tasks set status = 'done', resolved_at = now(), resolved_by = u_management where id = v_id;
      select count(*) into v_count from public.tasks where id = v_id and status = 'done';
      if v_count <> 1 then
        v_fail := v_fail || E'\n  - ' || '57: the assignee could not complete their own task';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('57: the assignee was refused: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- Somebody else's task, and no permission that covers it: refused. The
    -- assessor holds `applications.read` and no write of any kind.
    update public.tasks set status = 'open', resolved_at = null, resolved_by = null where id = v_id;
    begin
      perform pg_temp.impersonate(u_assessor);
      update public.tasks set status = 'done' where id = v_id;
      select count(*) into v_count from public.tasks where id = v_id and status = 'done';
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '57: somebody who was not the assignee ticked off another person''s task';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('57: unexpected error as the assessor: ' || sqlerrm);
    end;
    perform pg_temp.service();

    -- And campus scope still holds: a Broadhurst manager cannot see a task
    -- written for Block 7, however it was written.
    begin
      perform pg_temp.impersonate(u_campus_mgr);
      select count(*) into v_count from public.tasks where id = v_id;
      if v_count <> 0 then
        v_fail := v_fail || E'\n  - ' || '57: a Broadhurst manager saw a Block 7 staff task';
      end if;
    exception when others then
      v_fail := v_fail || E'\n  - ' || ('57: unexpected error as the Broadhurst manager: ' || sqlerrm);
    end;
    perform pg_temp.service();
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
