-- HR security regression suite.
--
-- The HR app's own cases, kept apart from security_regression.sql so the
-- admissions suite stays as it is. Same conventions: one transaction that
-- always aborts, attacks rather than assertions about policy text, and a
-- control beside each attack proving the legitimate case still works. The
-- last statement raises either
--
--   ALL HR SECURITY CHECKS PASSED (rolled back)
--   HR SECURITY REGRESSIONS: …

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
  u_admin uuid := gen_random_uuid();
  u_hr_manager uuid := gen_random_uuid();
  u_hr_staff uuid := gen_random_uuid();
  u_payroll uuid := gen_random_uuid();
  u_interviewer uuid := gen_random_uuid();
  u_admissions uuid := gen_random_uuid();
  c_a uuid;
  c_b uuid;
  v_a uuid;
  v_b uuid;
  q_a uuid;
  app_a uuid;
  app_b uuid;
  app_hired uuid;
  ref_a uuid;
  req_a uuid;
  v_count int;
  v_bool boolean;
  v_text text;
  e_a uuid;
  e_b uuid;
  run_a uuid;
  slip_a uuid;
  case_a uuid;
  ty uuid;
begin
  -- -------------------------------------------------------------------------
  -- Fixtures, as the service role
  -- -------------------------------------------------------------------------
  insert into auth.users (id, email) values
    (u_admin, 'hr-admin@test.invalid'), (u_hr_manager, 'hr-mgr@test.invalid'), (u_hr_staff, 'hr-staff@test.invalid'),
    (u_payroll, 'hr-payroll@test.invalid'), (u_interviewer, 'hr-int@test.invalid'), (u_admissions, 'adm@test.invalid');
  insert into public.staff_profiles (id, full_name, email) values
    (u_admin, 'Admin', 'hr-admin@test.invalid'), (u_hr_manager, 'HR Manager', 'hr-mgr@test.invalid'),
    (u_hr_staff, 'HR Staff', 'hr-staff@test.invalid'), (u_payroll, 'Payroll', 'hr-payroll@test.invalid'),
    (u_interviewer, 'Interviewer', 'hr-int@test.invalid'), (u_admissions, 'Admissions', 'adm@test.invalid');
  insert into public.staff_roles (staff_id, role_id) select u_admin, id from public.roles where code = 'super_admin';
  insert into public.staff_roles (staff_id, role_id) select u_hr_manager, id from public.roles where code = 'hr_manager';
  insert into public.staff_roles (staff_id, role_id) select u_hr_staff, id from public.roles where code = 'hr_staff';
  insert into public.staff_roles (staff_id, role_id) select u_payroll, id from public.roles where code = 'payroll_officer';
  insert into public.staff_roles (staff_id, role_id) select u_interviewer, id from public.roles where code = 'hr_interviewer';
  insert into public.staff_roles (staff_id, role_id) select u_admissions, id from public.roles where code = 'admissions_staff';

  insert into public.campuses (code, name, country, currency) values ('hr_test_a', 'HR Test A', 'BW', 'BWP') returning id into c_a;
  insert into public.campuses (code, name, country, currency) values ('hr_test_b', 'HR Test B', 'ZA', 'ZAR') returning id into c_b;
  insert into public.staff_campuses (staff_id, campus_id) values (u_interviewer, c_a);

  insert into public.hr_vacancies (campus_id, slug, title, phase, closes_on) values (c_a, 'hr-test-a', 'Grade R teacher', 'preschool', current_date + 30) returning id into v_a;
  insert into public.hr_vacancies (campus_id, slug, title, phase, closes_on) values (c_b, 'hr-test-b', 'Grade 3 teacher', 'primary', current_date + 30) returning id into v_b;
  insert into public.hr_vacancy_questions (vacancy_id, prompt, competency, rubric, origin, status)
    values (v_a, 'What do you do about a bruise?', 'safeguarding', '{"bands": []}', 'bank', 'approved') returning id into q_a;
  update public.hr_vacancies set status = 'published' where id in (v_a, v_b);

  insert into public.hr_applications (reference, vacancy_id, campus_id, email, email_normalised, first_name, last_name, privacy_notice_version, consented_at, status, stage, phone)
    values ('', v_a, c_a, 'a@test.invalid', 'a@test.invalid', 'Ann', 'Applicant', '2026-10', now(), 'submitted', 'review', '+26771000000') returning id into app_a;
  insert into public.hr_applications (reference, vacancy_id, campus_id, email, email_normalised, first_name, last_name, privacy_notice_version, consented_at, status, stage)
    values ('', v_b, c_b, 'b@test.invalid', 'b@test.invalid', 'Ben', 'Applicant', '2026-10', now(), 'submitted', 'review') returning id into app_b;
  insert into public.hr_applications (reference, vacancy_id, campus_id, email, email_normalised, first_name, last_name, privacy_notice_version, consented_at, status, stage)
    values ('', v_a, c_a, 'h@test.invalid', 'h@test.invalid', 'Hired', 'Person', '2026-10', now(), 'hired', 'shortlisted') returning id into app_hired;
  insert into public.hr_application_compliance (application_id, criminal_record, criminal_record_detail) values (app_a, true, 'A detail only HR may read');
  insert into public.hr_application_documents (application_id, kind, file_name, storage_path, mime, size_bytes, sha256) values
    (app_a, 'cv', 'cv.pdf', 'applications/' || app_a || '/00000000-0000-0000-0000-000000000001', 'application/pdf', 10, 'x'),
    (app_a, 'police_clearance', 'pc.pdf', 'applications/' || app_a || '/00000000-0000-0000-0000-000000000002', 'application/pdf', 10, 'y');
  insert into public.hr_application_answers (application_id, vacancy_question_id, answer_text) values (app_a, q_a, 'I would tell the safeguarding lead the same day.');
  insert into public.hr_referees (application_id, full_name, relationship, organisation, email) values (app_a, 'Rita Referee', 'principal', 'Old School', 'r@test.invalid') returning id into ref_a;
  insert into public.hr_reference_requests (referee_id, application_id, status) values (ref_a, app_a, 'sent') returning id into req_a;
  insert into public.hr_audit_log (actor_type, action, entity_type, sensitivity) values
    ('system', 'hr_test_normal', 'test', 'normal'), ('system', 'hr_test_pay', 'test', 'compensation');

  -- -------------------------------------------------------------------------
  -- H1. HR staff see every campus's applicants; the control.
  -- -------------------------------------------------------------------------
  perform pg_temp.impersonate(u_hr_staff);
  select count(*) into v_count from public.hr_applications where id in (app_a, app_b);
  if v_count <> 2 then v_fail := v_fail || E'\n  - H1: hr_staff saw ' || v_count || ' of 2 applications'; end if;
  select count(*) into v_count from public.hr_application_compliance where application_id = app_a;
  if v_count <> 1 then v_fail := v_fail || E'\n  - H1: hr_staff could not read compliance they hold the permission for'; end if;

  -- H2. A campus-scoped interviewer sees their campus only, and no compliance.
  perform pg_temp.impersonate(u_interviewer);
  select count(*) into v_count from public.hr_applications where id in (app_a, app_b);
  if v_count <> 1 then v_fail := v_fail || E'\n  - H2: interviewer at campus A saw ' || v_count || ' applications (expected 1)'; end if;
  select count(*) into v_count from public.hr_application_compliance;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H2: interviewer read compliance answers'; end if;
  -- H14. ...and the CV but not the police clearance.
  select count(*) into v_count from public.hr_application_documents where application_id = app_a and kind = 'cv';
  if v_count <> 1 then v_fail := v_fail || E'\n  - H14: interviewer could not see the CV'; end if;
  select count(*) into v_count from public.hr_application_documents where application_id = app_a and kind = 'police_clearance';
  if v_count <> 0 then v_fail := v_fail || E'\n  - H14: interviewer saw a police clearance'; end if;

  -- H3. Admissions staff see nothing of HR.
  perform pg_temp.impersonate(u_admissions);
  select count(*) into v_count from public.hr_applications;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H3: admissions staff saw ' || v_count || ' HR applications'; end if;
  select count(*) into v_count from public.hr_reference_requests;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H3: admissions staff saw HR references'; end if;
  select count(*) into v_count from public.hr_settings;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H3: admissions staff read HR settings'; end if;

  -- H4. Anonymous visitors see nothing at all.
  perform pg_temp.service();
  execute 'set local role anon';
  -- Refused either way: no rows, or the policy's helper is not executable by anon.
  begin
    select count(*) into v_count from public.hr_applications;
    if v_count <> 0 then v_fail := v_fail || E'\n  - H4: anon saw applications'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into v_count from public.hr_vacancies;
    if v_count <> 0 then v_fail := v_fail || E'\n  - H4: anon read vacancies directly'; end if;
  exception when insufficient_privilege then null;
  end;

  -- H5. Staff cannot write an application directly: the engine is the only writer.
  perform pg_temp.impersonate(u_hr_manager);
  update public.hr_applications set stage = 'shortlisted' where id = app_a;
  get diagnostics v_count = row_count;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H5: hr_manager moved a stage with a direct update'; end if;
  begin
    insert into public.hr_application_notes (application_id, author_id, body) values (app_a, u_hr_manager, 'direct');
    v_fail := v_fail || E'\n  - H5: a note was written without the server';
  exception when insufficient_privilege then null;
  end;

  -- H6. Tokens and the job queue are sealed from staff.
  select count(*) into v_count from public.hr_access_tokens;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H6: staff read token hashes'; end if;
  select count(*) into v_count from public.hr_jobs;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H6: hr_manager read the job queue'; end if;

  -- H7. Pay is strict: admin alone does not hold it.
  perform pg_temp.impersonate(u_admin);
  select public.hr_has_strict('hr.compensation.read') into v_bool;
  if v_bool then v_fail := v_fail || E'\n  - H7: admin passed the strict pay check'; end if;
  select public.has_permission('hr.recruitment.read') into v_bool;
  if not v_bool then v_fail := v_fail || E'\n  - H7: admin lost ordinary HR access'; end if;
  perform pg_temp.impersonate(u_payroll);
  select public.hr_has_strict('hr.compensation.read') into v_bool;
  if not v_bool then v_fail := v_fail || E'\n  - H7: the payroll officer failed the strict pay check'; end if;

  -- H12. A compensation audit row is hidden from admin and shown to the HR manager.
  perform pg_temp.impersonate(u_admin);
  select count(*) into v_count from public.hr_audit_log where action = 'hr_test_pay';
  if v_count <> 0 then v_fail := v_fail || E'\n  - H12: admin read a salary audit row'; end if;
  select count(*) into v_count from public.hr_audit_log where action = 'hr_test_normal';
  if v_count <> 1 then v_fail := v_fail || E'\n  - H12: admin could not read an ordinary audit row'; end if;
  perform pg_temp.impersonate(u_hr_manager);
  select count(*) into v_count from public.hr_audit_log where action = 'hr_test_pay';
  if v_count <> 1 then v_fail := v_fail || E'\n  - H12: the HR manager could not read a salary audit row'; end if;

  -- H8 / H15. The service-only functions refuse staff.
  begin
    perform public.hr_commit_stage(app_a, 'review', 'shortlisted', null, u_hr_manager);
    v_fail := v_fail || E'\n  - H8: staff called hr_commit_stage directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.hr_anonymise_applicant(app_b);
    v_fail := v_fail || E'\n  - H8: staff called hr_anonymise_applicant';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.hr_consume_token('x', null, null);
    v_fail := v_fail || E'\n  - H15: staff called hr_consume_token';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.hr_claim_jobs('w', 1);
    v_fail := v_fail || E'\n  - H15: staff claimed HR jobs';
  exception when insufficient_privilege then null;
  end;

  -- -------------------------------------------------------------------------
  -- As the service role: the engine's own guarantees.
  -- -------------------------------------------------------------------------
  perform pg_temp.service();

  -- H11. The stage is compare-and-set.
  perform public.hr_commit_stage(app_a, 'review', 'shortlisted', 'Strong', u_hr_manager);
  begin
    perform public.hr_commit_stage(app_a, 'review', 'unsuccessful', 'Stale click', u_hr_manager);
    v_fail := v_fail || E'\n  - H11: a stale stage move was accepted';
  exception when raise_exception then
    get stacked diagnostics v_text = message_text;
    if v_text <> 'stale_stage' then v_fail := v_fail || E'\n  - H11: stale move raised ' || v_text; end if;
  end;
  select count(*) into v_count from public.hr_application_events where application_id = app_a and kind = 'stage_changed';
  if v_count <> 1 then v_fail := v_fail || E'\n  - H11: the stage change left ' || v_count || ' events'; end if;
  begin
    perform public.hr_commit_stage(app_b, 'review', 'review', null, null, 'hired');
    v_fail := v_fail || E'\n  - H11: an applicant was hired from Review';
  exception when raise_exception then null;
  end;

  -- H10. Questions are frozen once the vacancy is published.
  begin
    insert into public.hr_vacancy_questions (vacancy_id, prompt, competency, rubric, origin) values (v_a, 'Late addition', 'pedagogy', '{"bands": []}', 'manual');
    v_fail := v_fail || E'\n  - H10: a question was added to a published vacancy';
  exception when raise_exception then null;
  end;
  begin
    update public.hr_vacancy_questions set prompt = 'Changed after publishing' where id = q_a;
    v_fail := v_fail || E'\n  - H10: a published question was edited';
  exception when raise_exception then null;
  end;

  -- H13. A token names exactly the subject its purpose says.
  begin
    insert into public.hr_access_tokens (purpose, hr_application_id, hr_reference_request_id, token_hash, expires_at)
      values ('application', app_a, req_a, 'hash-both', now() + interval '1 day');
    v_fail := v_fail || E'\n  - H13: a token named two subjects';
  exception when check_violation then null;
  end;
  begin
    insert into public.hr_access_tokens (purpose, hr_application_id, token_hash, expires_at)
      values ('reference', app_a, 'hash-wrong', now() + interval '1 day');
    v_fail := v_fail || E'\n  - H13: a reference token named an application';
  exception when check_violation then null;
  end;

  -- H9. Anonymising clears the personal data and refuses a hired applicant.
  perform public.hr_anonymise_applicant(app_a);
  select count(*) into v_count from public.hr_applications
   where id = app_a and (first_name <> 'Removed' or phone is not null or email not like 'removed-%' or status <> 'anonymised');
  if v_count <> 0 then v_fail := v_fail || E'\n  - H9: personal fields survived anonymising'; end if;
  select count(*) into v_count from public.hr_application_compliance where application_id = app_a;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H9: compliance answers survived anonymising'; end if;
  select count(*) into v_count from public.hr_referees where application_id = app_a;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H9: referees survived anonymising'; end if;
  select count(*) into v_count from public.hr_application_answers where application_id = app_a and answer_text <> '';
  if v_count <> 0 then v_fail := v_fail || E'\n  - H9: answer text survived anonymising'; end if;
  select count(*) into v_count from public.hr_application_documents where application_id = app_a;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H9: document rows survived anonymising'; end if;
  begin
    perform public.hr_anonymise_applicant(app_hired);
    v_fail := v_fail || E'\n  - H9: a hired applicant was anonymised';
  exception when raise_exception then null;
  end;

  -- -------------------------------------------------------------------------
  -- Employees, pay and discipline
  -- -------------------------------------------------------------------------
  perform pg_temp.service();
  insert into public.hr_employees (employee_number, campus_id, first_name, last_name, position_title, start_date)
    values ('', c_a, 'Edna', 'Employee', 'Teacher', '2026-01-01') returning id into e_a;
  insert into public.hr_employees (employee_number, campus_id, first_name, last_name, position_title, start_date)
    values ('', c_b, 'Eric', 'Employee', 'Teacher', '2026-01-01') returning id into e_b;
  insert into public.hr_employee_private (employee_id, id_number) values (e_a, '1234567');
  insert into public.hr_employee_compensation (employee_id, effective_from, basic_monthly_minor, currency) values (e_a, '2026-01-01', 1850000, 'BWP');
  insert into public.hr_employee_bank (employee_id, bank_name, account_name, account_number) values (e_a, 'FNB', 'E Employee', '62000000001');
  insert into public.hr_payroll_runs (campus_id, period, country, currency, status, prepared_by, prepared_at)
    values (c_a, '2026-10', 'BW', 'BWP', 'calculated', u_payroll, now()) returning id into run_a;
  insert into public.hr_payslips (run_id, employee_id, employee_snapshot, gross_minor, taxable_minor, paye_minor, deductions_minor, net_minor, employer_cost_minor, calc_version, inputs)
    values (run_a, e_a, '{}', 1850000, 1850000, 200000, 200000, 1650000, 1850000, 'test', '{}') returning id into slip_a;
  insert into public.hr_payslip_lines (payslip_id, code, label, kind, computed_minor, effective_minor) values (slip_a, 'BASIC', 'Basic salary', 'earning', 1850000, 1850000);
  insert into public.hr_disciplinary_cases (employee_id, category, summary) values (e_a, 'absence', 'Late on five days') returning id into case_a;
  insert into public.hr_case_events (case_id, kind, body) values (case_a, 'note', 'Opened');

  -- H18. HR staff read employees but no pay: no salary, bank, run or payslip.
  perform pg_temp.impersonate(u_hr_staff);
  select count(*) into v_count from public.hr_employees where id in (e_a, e_b);
  if v_count <> 2 then v_fail := v_fail || E'\n  - H18: hr_staff saw ' || v_count || ' of 2 employees'; end if;
  select (select count(*) from public.hr_employee_compensation) + (select count(*) from public.hr_employee_bank)
       + (select count(*) from public.hr_payroll_runs) + (select count(*) from public.hr_payslips) + (select count(*) from public.hr_payslip_lines)
    into v_count;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H18: hr_staff read ' || v_count || ' pay rows'; end if;
  select count(*) into v_count from public.hr_employee_private;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H18: hr_staff read private details without the sensitive permission'; end if;
  select count(*) into v_count from public.hr_disciplinary_cases where id = case_a;
  if v_count <> 1 then v_fail := v_fail || E'\n  - H18: hr_staff could not read a disciplinary case they hold the permission for'; end if;

  -- The control: the payroll officer reads all of it, but no discipline.
  perform pg_temp.impersonate(u_payroll);
  select (select count(*) from public.hr_employee_compensation where employee_id = e_a) + (select count(*) from public.hr_employee_bank where employee_id = e_a)
       + (select count(*) from public.hr_payroll_runs where id = run_a) + (select count(*) from public.hr_payslips where id = slip_a)
    into v_count;
  if v_count <> 4 then v_fail := v_fail || E'\n  - H18: the payroll officer read ' || v_count || ' of 4 pay rows'; end if;
  select count(*) into v_count from public.hr_disciplinary_cases;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H18: the payroll officer read disciplinary cases'; end if;

  -- H19. The admissions super administrator holds `admin`, which is not enough for pay.
  perform pg_temp.impersonate(u_admin);
  select (select count(*) from public.hr_employee_compensation) + (select count(*) from public.hr_employee_bank)
       + (select count(*) from public.hr_payroll_runs) + (select count(*) from public.hr_payslips)
    into v_count;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H19: admin read ' || v_count || ' pay rows'; end if;

  -- H20. The HR manager reads private details; an interviewer and admissions staff read no employee at all.
  perform pg_temp.impersonate(u_hr_manager);
  select count(*) into v_count from public.hr_employee_private where employee_id = e_a;
  if v_count <> 1 then v_fail := v_fail || E'\n  - H20: the HR manager could not read private details'; end if;
  perform pg_temp.impersonate(u_interviewer);
  select count(*) into v_count from public.hr_employees;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H20: an interviewer read employees'; end if;
  perform pg_temp.impersonate(u_admissions);
  select count(*) into v_count from public.hr_employees;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H20: admissions staff read employees'; end if;

  -- H21. Staff never write pay directly, even the HR manager.
  perform pg_temp.impersonate(u_hr_manager);
  begin
    insert into public.hr_employee_compensation (employee_id, effective_from, basic_monthly_minor, currency) values (e_a, '2026-11-01', 9900000, 'BWP');
    v_fail := v_fail || E'\n  - H21: a member of staff wrote a salary directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.hr_payroll_runs set status = 'approved', approved_by = u_hr_manager where id = run_a;
    get diagnostics v_count = row_count;
    if v_count <> 0 then v_fail := v_fail || E'\n  - H21: a member of staff approved a run directly'; end if;
  exception when insufficient_privilege then null;
  end;

  -- H22. Four eyes: the preparer cannot approve, even as the service role.
  perform pg_temp.service();
  begin
    update public.hr_payroll_runs set status = 'approved', approved_by = u_payroll, approved_at = now() where id = run_a;
    v_fail := v_fail || E'\n  - H22: the person who prepared a run approved it';
  exception when check_violation then null;
  end;

  -- H23. An approved run is frozen: payslips, lines and status.
  update public.hr_payroll_runs set status = 'approved', approved_by = u_hr_manager, approved_at = now() where id = run_a;
  begin
    update public.hr_payslips set net_minor = 9999999 where id = slip_a;
    v_fail := v_fail || E'\n  - H23: a payslip in an approved run changed';
  exception when raise_exception then null;
  end;
  begin
    insert into public.hr_payslip_lines (payslip_id, code, label, kind, computed_minor, effective_minor) values (slip_a, 'BONUS', 'Bonus', 'earning', 100, 100);
    v_fail := v_fail || E'\n  - H23: a line was added to an approved run';
  exception when raise_exception then null;
  end;
  begin
    update public.hr_payroll_runs set status = 'calculated' where id = run_a;
    v_fail := v_fail || E'\n  - H23: an approved run went back to calculated';
  exception when raise_exception then null;
  end;
  update public.hr_payroll_runs set status = 'locked', locked_by = u_hr_manager, locked_at = now() where id = run_a;
  begin
    update public.hr_payroll_runs set totals = '{"x": 1}' where id = run_a;
    v_fail := v_fail || E'\n  - H23: a locked run changed';
  exception when raise_exception then null;
  end;

  -- H24. A published tax year cannot change; a draft can.
  insert into public.hr_tax_years (country, code, starts_on, ends_on, parameters) values ('BW', 'BW-TEST', '2099-07-01', '2100-06-30', '{"pensionCapRate": 0.15}') returning id into ty;
  insert into public.hr_tax_brackets (tax_year_id, residency, lower_minor, upper_minor, base_tax_minor, rate) values (ty, 'resident', 0, null, 0, 0.1);
  update public.hr_tax_years set status = 'published' where id = ty;
  begin
    update public.hr_tax_years set parameters = '{"pensionCapRate": 0.5}' where id = ty;
    v_fail := v_fail || E'\n  - H24: a published tax year changed';
  exception when raise_exception then null;
  end;
  begin
    update public.hr_tax_brackets set rate = 0.01 where tax_year_id = ty;
    v_fail := v_fail || E'\n  - H24: a bracket of a published tax year changed';
  exception when raise_exception then null;
  end;

  -- H25. A disciplinary record cannot be rewritten.
  begin
    update public.hr_case_events set body = 'Something else' where case_id = case_a;
    v_fail := v_fail || E'\n  - H25: a case record entry was rewritten';
  exception when raise_exception then null;
  end;

  -- H16. Every hr_ table has row-level security on.
  select count(*) into v_count
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'hr\_%' and not c.relrowsecurity;
  if v_count <> 0 then v_fail := v_fail || E'\n  - H16: ' || v_count || ' hr_ tables without RLS'; end if;

  -- H17. No hr_ function is executable by anon.
  select string_agg(p.proname, ', ') into v_text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'hr\_%' and has_function_privilege('anon', p.oid, 'execute');
  if v_text is not null then v_fail := v_fail || E'\n  - H17: anon may execute ' || v_text; end if;

  if v_fail <> '' then
    raise exception 'HR SECURITY REGRESSIONS:%', v_fail;
  end if;
  raise exception 'ALL HR SECURITY CHECKS PASSED (rolled back)';
end
$$;
