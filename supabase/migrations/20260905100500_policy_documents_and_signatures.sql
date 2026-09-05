-- The school's four 2026 policy documents, in their own words, and a drawn
-- signature on every acceptance.
--
-- The Parent Acknowledgement and Agreement is the document a parent signs;
-- by signing it they acknowledge the Learner Code of Conduct, the Parent
-- Policy and the Fees Policy. All four are required agreements here, shown
-- in reading order, each carrying the document's full text so the body the
-- parent signed (and its hash) is the document itself. The PDFs are served
-- by the application under /policies/2026/, so the text and the file are
-- always the same version.

-- ---------------------------------------------------------------------------
-- Reading order, and links that may point at the application itself
-- ---------------------------------------------------------------------------

alter table public.agreement_templates
  add column if not exists sort_order int not null default 100;

comment on column public.agreement_templates.sort_order is
  'Order the agreements are shown to the parent; the acknowledgement that refers to the others comes last.';

alter table public.agreement_templates drop constraint if exists agreement_templates_document_url_check;
alter table public.agreement_templates
  add constraint agreement_templates_document_url_check
  check (document_url is null or document_url ~ '^(https://|/[A-Za-z0-9])');

-- A new version keeps its place in the reading order.
create or replace function public.publish_agreement_template(
  p_key text,
  p_name text,
  p_description text,
  p_body_html text,
  p_required boolean,
  p_document_url text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_next int;
  v_sort int;
  v_id uuid;
begin
  if not public.has_permission('templates.write') then
    raise exception 'permission_denied';
  end if;
  if p_key !~ '^[a-z0-9_]+$' then
    raise exception 'template_key_invalid';
  end if;
  if p_document_url is not null and p_document_url !~ '^(https://|/[A-Za-z0-9])' then
    raise exception 'document_url_invalid';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.agreement_templates where key = p_key;
  select sort_order into v_sort from public.agreement_templates where key = p_key order by version desc limit 1;
  update public.agreement_templates set is_active = false where key = p_key and is_active;
  insert into public.agreement_templates (key, version, name, description, body_html, required, document_url, sort_order, is_active, created_by)
  values (p_key, v_next, p_name, p_description, p_body_html, p_required, p_document_url, coalesce(v_sort, 100), true, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- The signature
-- ---------------------------------------------------------------------------

-- What the parent drew, as an SVG the server built from the validated
-- strokes. The typed name stays as the printed name beside it. Null on
-- acceptances recorded before this migration.
alter table public.agreement_acceptances
  add column if not exists signature_svg text
    check (signature_svg is null or (signature_svg like '<svg %' and length(signature_svg) <= 65536));

comment on column public.agreement_acceptances.signature_svg is
  'The signature the parent drew, rendered by the server from validated strokes; the typed signature_name is the printed name.';

-- ---------------------------------------------------------------------------
-- The documents, in their own words (January 2026 editions)
-- ---------------------------------------------------------------------------

do $$
declare
  v_next int;
begin
  -- Learner Code of Conduct
  select coalesce(max(version), 0) + 1 into v_next from public.agreement_templates where key = 'learner_code_of_conduct';
  update public.agreement_templates set is_active = false where key = 'learner_code_of_conduct' and is_active;
  insert into public.agreement_templates (key, version, name, description, body_html, required, document_url, sort_order, is_active)
  values ('learner_code_of_conduct', v_next, 'Learner Code of Conduct',
    'The school''s Learner Code of Conduct, January 2026 edition. Read it with your child.',
    '<h2>Learner Code of Conduct</h2>'
    '<h3>1. Policy Statement</h3>'
    '<p>1.1 Hibiscus Schools expects the highest standard of conduct from all learners. This includes behaviour in classrooms, on school grounds, during sports and cultural activities, at school events, online, and at any time when a learner represents Hibiscus Schools.</p>'
    '<p>1.2 This Code sets out the responsibilities of all stakeholders. Failure to comply may result in disciplinary action in line with Hibiscus Schools'' Disciplinary Procedures.</p>'
    '<p>1.3 Hibiscus Schools promotes integrity, honesty, respect, responsibility, good manners, inclusivity, and punctuality.</p>'
    '<h3>2. Policy Stakeholders and Responsibilities</h3>'
    '<p><strong>2.1 Applicability.</strong> This Code applies to all learners enrolled at Hibiscus Schools, as well as their parents/guardians and all staff members.</p>'
    '<p><strong>2.2 School Responsibilities.</strong> Hibiscus Schools will:</p>'
    '<ul><li>Make this Code of Conduct available to parents and learners</li><li>Ensure consistent and fair implementation of the Code</li><li>Communicate expectations clearly to all stakeholders</li></ul>'
    '<p><strong>2.3 Staff Responsibilities.</strong> Teachers and staff will:</p>'
    '<ul><li>Enforce this Code consistently and fairly</li><li>Model respectful and professional behaviour</li><li>Inform learners and parents of disciplinary procedures</li></ul>'
    '<p><strong>2.4 Learner Responsibilities.</strong> Learners are expected to:</p>'
    '<ul><li>Familiarize themselves with and comply with this Code</li><li>Behave responsibly and respectfully towards others</li><li>Follow instructions from staff</li><li>Respect school property and the property of others</li><li>Act honestly and with integrity</li><li>Attend school punctually and regularly</li><li>Accept disciplinary action as corrective and educational</li></ul>'
    '<p><strong>2.5 Parent/Guardian Responsibilities.</strong> Parents/guardians are expected to:</p>'
    '<ul><li>Support the school in enforcing this Code</li><li>Ensure learners understand behavioral expectations</li><li>Communicate with the school regarding learner progress and behavior</li><li>Attend meetings when requested</li></ul>'
    '<h3>3. General Rules and Guidelines</h3>'
    '<p>3.1 All learners are bound by this Code while on school premises, at school activities, and when representing Hibiscus Schools.</p>'
    '<p>3.2 Hibiscus Schools is a drug-free, alcohol-free, weapon-free, smoke-free, and gambling-free environment.</p>'
    '<p>3.3 Learners must respect the learning environment and the rights of others to learn.</p>'
    '<p>3.4 Misconduct occurring off school premises that impacts the school community may be subject to disciplinary action.</p>'
    '<h3>4. Categories of Misconduct</h3>'
    '<p>Misconduct is categorised as <strong>Very Serious</strong>, <strong>Serious</strong>, or <strong>Minor</strong>. Each case will be dealt with on its own merits.</p>'
    '<p><strong>4.1 Very Serious Misconduct</strong> (may result in suspension or expulsion). Includes but is not limited to:</p>'
    '<ul><li>Violence, bullying, intimidation, or harassment (including cyberbullying)</li><li>Possession or use of weapons, drugs, alcohol, or prohibited substances</li><li>Sexual misconduct or harassment</li><li>Serious dishonesty, theft, or fraud</li><li>Actions that endanger the safety of others</li><li>Serious conduct bringing the school into disrepute</li></ul>'
    '<p><strong>4.2 Serious Misconduct.</strong> Includes but is not limited to:</p>'
    '<ul><li>Truancy or persistent absenteeism</li><li>Repeated disruption of school activities</li><li>Vandalism or damage to property</li><li>Insubordination or repeated defiance</li></ul>'
    '<p><strong>4.3 Minor Misconduct.</strong> Includes but is not limited to:</p>'
    '<ul><li>Late-coming</li><li>Inappropriate language</li><li>Failure to complete homework</li><li>Poor classroom behaviour</li><li>Dress code violations</li></ul>'
    '<p>Sanctions may range from warnings and counselling to suspension or expulsion, depending on severity and repetition.</p>'
    '<h3>5. Disciplinary Approach</h3>'
    '<p>5.1 Hibiscus Schools follows a restorative and corrective approach to discipline.</p>'
    '<p>5.2 Disciplinary measures aim to:</p>'
    '<ul><li>Correct behaviour</li><li>Protect the learning environment</li><li>Educate learners about responsibility and consequences</li></ul>'
    '<h3>6. Amendment and Review</h3>'
    '<p>6.1 This Code of Conduct will be reviewed regularly to ensure alignment with legislation and best practice.</p>'
    '<p>6.2 Hibiscus Schools reserves the right to amend this Code when necessary.</p>'
    '<h3>7. Acknowledgement</h3>'
    '<p>Learners and parents/guardians are required to sign an acknowledgement confirming that they have read, understood, and agree to abide by this Code of Conduct.</p>'
    '<p><em>January 2026</em></p>',
    true, '/policies/2026/Learner-Code-of-Conduct.pdf', 10, true);

  -- Parent Policy
  select coalesce(max(version), 0) + 1 into v_next from public.agreement_templates where key = 'parent_policy';
  update public.agreement_templates set is_active = false where key = 'parent_policy' and is_active;
  insert into public.agreement_templates (key, version, name, description, body_html, required, document_url, sort_order, is_active)
  values ('parent_policy', v_next, 'Parent Policy',
    'The school''s Parent Policy, January 2026 edition: what the school asks of parents and guardians.',
    '<h2>Parent Policy</h2>'
    '<p><strong>Applicability:</strong> All parents and guardians of learners enrolled at Hibiscus Schools</p>'
    '<h3>1. Policy Purpose</h3>'
    '<p>1.1 Hibiscus Schools recognises the importance of a strong partnership between parents and the school.</p>'
    '<p>1.2 This Parent Policy sets out the expectations, responsibilities, and standards of conduct required of parents and guardians in order to support learners, staff, and the wider school community.</p>'
    '<h3>2. Parental Responsibilities</h3>'
    '<p>2.1 Parents and guardians are expected to:</p>'
    '<ul><li>Ensure that their child attends school regularly and punctually.</li><li>Provide a supportive and structured learning environment at home.</li><li>Inform the school of any circumstances that may affect the learner''s academic performance, behaviour, or wellbeing.</li><li>Ensure that learners arrive at school with the required learning materials and in the correct school uniform.</li><li>Monitor homework, assessments, and academic progress.</li><li>Attend scheduled parent-teacher meetings, workshops, and school engagements when requested.</li><li>Support the class teacher in maintaining discipline and appropriate learner behaviour.</li></ul>'
    '<h3>3. Communication</h3>'
    '<p>3.1 All communication with the school must be conducted respectfully and through the appropriate channels.</p>'
    '<p>3.2 Parents must:</p>'
    '<ul><li>Direct queries, concerns, or complaints to the relevant teacher, Head of Department, or Head of School.</li><li>Arrange appointments with staff in advance via the school office.</li><li>Allow a reasonable response time (normally up to 48 hours) for replies to emails or messages.</li><li>Ensure that contact details are kept up to date.</li><li>Access official school communication via approved platforms, including email, WhatsApp groups, and the Edana Parent Portal.</li></ul>'
    '<p>3.3 Aggressive behaviour, public criticism of staff, or inappropriate communication will not be tolerated.</p>'
    '<h3>4. Code of Conduct for Parents</h3>'
    '<p>4.1 Parents and guardians are required to:</p>'
    '<ul><li>Treat all staff, learners, and other parents with dignity, respect, and courtesy.</li><li>Refrain from aggressive, threatening, or inappropriate behaviour on school premises or in communication with staff.</li><li>Not discipline or confront other learners directly. All concerns must be referred to school management.</li></ul>'
    '<p>4.2 Social media posts or communications that defame, misrepresent, or bring the school, its staff, or learners into disrepute are prohibited and may result in disciplinary or legal action.</p>'
    '<h3>5. Involvement and Participation</h3>'
    '<p>5.1 Parents are encouraged to support school events, participate in parent initiatives, and engage constructively with Parent Representatives.</p>'
    '<p>5.2 Any fundraising or external activity involving the school must receive prior written approval from the Head of School.</p>'
    '<h3>6. Events, Trips, Camps and School Activities</h3>'
    '<p>6.1 Participation in events, excursions, camps or activities requiring payment is conditional upon:</p>'
    '<ul><li>Submission of all required consent forms by the deadline as stipulated, and</li><li>Full payment by the stipulated deadline.</li><li>This ensures the school has adequate time to prepare for the event and finalize arrangements.</li><li>No refunds will be given for any cancellations.</li></ul>'
    '<p>6.2 Late submissions or payments will not be accepted on the day of the event and may result in the learner being excluded from participation.</p>'
    '<h3>7. Staff Changes and Classroom Reassignments</h3>'
    '<p>7.1 Parents acknowledge that staff changes and reassignments are a normal part of school operations.</p>'
    '<p>7.2 The school reserves the right to make staffing decisions in the best interest of learners and operational continuity.</p>'
    '<p>7.3 Parents may be informed of staff changes once the transition has been assessed and deemed stable.</p>'
    '<h3>8. Smoking, Alcohol, and Substance Use</h3>'
    '<p>8.1 Smoking, alcohol consumption, or use of illegal substances is strictly prohibited on school premises and at all school-related events.</p>'
    '<p>8.2 Any breach may result in removal from the premises and restriction from future school activities.</p>'
    '<h3>9. Safety and Security</h3>'
    '<p>9.1 Parents must comply with all safety and security procedures, including visitor sign-in requirements.</p>'
    '<p>9.2 Learners must be collected promptly at the end of the school day. Late collections must be communicated in advance.</p>'
    '<p>9.3 Only authorised persons may collect learners.</p>'
    '<p>9.4 Parents are not permitted to remain on school premises once classes commence without prior approval.</p>'
    '<p>9.5 Gate access times, parking rules, and traffic safety requirements must be observed at all times.</p>'
    '<p>9.6 The school reserves the right to prevent a learner from leaving the premises if a driver is deemed unfit to operate a vehicle safely.</p>'
    '<h3>10. Personal Hygiene, Uniform, and Belongings</h3>'
    '<p>10.1 Learners are expected to maintain a high standard of personal hygiene and grooming.</p>'
    '<p>10.2 The correct school uniform must be worn daily, clean and well-maintained.</p>'
    '<p>10.3 All personal belongings must be clearly labelled. The school cannot be held responsible for lost or unlabeled items.</p>'
    '<h3>11. Assessment and Examination Attendance</h3>'
    '<p>11.1 Assessment and examination dates are fixed and will not be rescheduled for individual learners.</p>'
    '<p>11.2 Learners absent during an assessment will receive no mark unless:</p>'
    '<ul><li>Prior approval was granted by the Head of School, or</li><li>A valid medical certificate is submitted within 48 hours.</li></ul>'
    '<p>11.3 The school reserves the right to determine whether a make-up assessment will be granted.</p>'
    '<h3>12. Responsibility for Missed Schoolwork</h3>'
    '<p>12.1 In the event of learner absence, parents are responsible for:</p>'
    '<ul><li>Notifying the school of the absence,</li><li>Supporting the learner in catching up on missed work, and</li><li>Ensuring outstanding school fees are settled where applicable.</li></ul>'
    '<p>12.2 The school will provide reasonable guidance upon the learner''s return but is not obligated to fully remediate extended or fee-related absences.</p>'
    '<h3>13. Holiday Homework</h3>'
    '<p>13.1 School holidays are intended for rest and recovery.</p>'
    '<p>13.2 The school is not responsible for preparing individual holiday work packs on request.</p>'
    '<p>13.3 In examination or checkpoint years, teachers may provide revision materials at their discretion.</p>'
    '<h3>14. Financial Responsibilities</h3>'
    '<p>14.1 School fees must be paid in full and on time in accordance with the school''s Fees Policy.</p>'
    '<p>14.2 The school reserves the right to deny entry or suspend attendance where fees are outstanding.</p>'
    '<p>14.3 No refunds will be issued for absenteeism or circumstances beyond the school''s control.</p>'
    '<h3>15. Breach of Policy</h3>'
    '<p>15.1 Failure to comply with this policy may result in:</p>'
    '<ul><li>Formal warnings</li><li>Restriction from school events</li><li>Denial of access to school premises</li><li>Legal action in serious cases</li></ul>',
    true, '/policies/2026/Parent-Policy.pdf', 20, true);

  -- Fees Policy
  select coalesce(max(version), 0) + 1 into v_next from public.agreement_templates where key = 'fees_policy';
  update public.agreement_templates set is_active = false where key = 'fees_policy' and is_active;
  insert into public.agreement_templates (key, version, name, description, body_html, required, document_url, sort_order, is_active)
  values ('fees_policy', v_next, 'Fees Policy',
    'The school''s Fees Policy, January 2026 edition: what is charged, when it is paid, and the notice period.',
    '<h2>Fees Policy</h2>'
    '<h3>1. Policy Statement</h3>'
    '<p>1.1 It is the policy of Hibiscus Schools ("the School") to charge fees for the provision of education and other services to learners enrolled at Hibiscus Schools.</p>'
    '<p>1.2 This policy must be communicated to all stakeholders, including parents, guardians and account holders, and be made available by the School to parents and guardians.</p>'
    '<h3>2. Fee Determination</h3>'
    '<p>2.1 Fees at Hibiscus Schools are determined annually for a period of twelve (12) months.</p>'
    '<p>2.2 Stakeholders must be informed of changes in fees, in writing, at least one month prior to the changes becoming effective.</p>'
    '<h3>3. Fee Types</h3>'
    '<p>Hibiscus Schools reserves the right to charge, where applicable:</p>'
    '<ul><li>Enrolment or registration fees</li><li>Admission fee</li><li>School fees</li><li>Aftercare fees</li><li>Late pick-up fees</li><li>Educational resource fees (workbooks, etc.)</li><li>Practical experiments or project material fee</li><li>Excursion fees</li><li>Breakfast/Lunch fees</li></ul>'
    '<h3>4. Application and Admission Fees</h3>'
    '<p>4.1 Application and Admission fees are payable for every new learner where applicable.</p>'
    '<p>4.2 A learner''s place is confirmed only once the application and admission fee has been paid in full.</p>'
    '<p>4.3 Application and Admission fees are non-refundable.</p>'
    '<h3>5. School Fees</h3>'
    '<p>5.1 School fees are payable annually, termly, or monthly by EFT unless otherwise approved.</p>'
    '<p>5.2 Fees are payable in advance and are not dependent on receipt of a statement.</p>'
    '<h3>6. Borrowed Books</h3>'
    '<p>Any loss, damage, or failure to return borrowed books belonging to Hibiscus Schools (including textbooks and library books) will result in the full replacement cost being invoiced to the parent/guardian or account holder. Such amounts are payable immediately and are not subject to dispute.</p>'
    '<h3>7. Payment Methods</h3>'
    '<p>7.1 Fees are payable via direct bank transfer.</p>'
    '<p>7.2 No cash payments are accepted on school premises.</p>'
    '<h3>8. Outstanding School Fees</h3>'
    '<p>8.1 Hibiscus Schools reserve the right to allow access to the school, report cards and transfer certificates for a student if school fees are in arrears.</p>'
    '<h3>9. Notice of Withdrawal</h3>'
    '<p>9.1 One (1) full school term''s written notice of withdrawal must be submitted via email to the Head of School or the Finance Department.</p>'
    '<p>9.2 School fees for the full notice period are payable in full, irrespective of whether the learner attends school, attends partially, or does not attend school at all during the notice period.</p>'
    '<p>9.3 Where the required notice is given, the learner may attend school during the notice period, subject to compliance with all school rules and policies.</p>'
    '<h3>10. Amendments</h3>'
    '<p>10.1 This policy may be amended by the authorised governance of Hibiscus Schools.</p>',
    true, '/policies/2026/Fees-Policy.pdf', 30, true);

  -- Parent Acknowledgement and Agreement: the document the parent signs.
  -- Sections 5 and 6 of the printed form are the learner and parent details
  -- and the signature lines; here they are the registration itself and the
  -- signature drawn below.
  select coalesce(max(version), 0) + 1 into v_next from public.agreement_templates where key = 'parent_acknowledgement_agreement';
  update public.agreement_templates set is_active = false where key = 'parent_acknowledgement_agreement' and is_active;
  insert into public.agreement_templates (key, version, name, description, body_html, required, document_url, sort_order, is_active)
  values ('parent_acknowledgement_agreement', v_next, 'Parent Acknowledgement and Agreement',
    'The agreement between Hibiscus Schools and the parent or guardian, January 2026 edition. Signing it acknowledges the three policies above.',
    '<h2>Parent Acknowledgement and Agreement</h2>'
    '<p>This Agreement is entered into between Hibiscus Schools and the undersigned parent(s)/guardian(s) of the learner named below.</p>'
    '<h3>1. Acknowledgement of Policies</h3>'
    '<p>By signing this document, I/we hereby acknowledge that I/we have received, read, and understood the following Hibiscus Schools policies, as amended from time to time:</p>'
    '<ul><li>Learner Code of Conduct</li><li>Parent Policy</li><li>Fees Policy</li></ul>'
    '<p>I/we understand that these policies apply to all learners and parents/guardians and form an integral part of the conditions of enrolment at Hibiscus Schools.</p>'
    '<h3>2. Agreement to Comply</h3>'
    '<p>I/we agree to:</p>'
    '<ul><li>Support and uphold the Learner Code of Conduct and ensure that my/our child complies with all school rules, behavioural expectations, and disciplinary procedures.</li><li>Conduct myself/ourselves in accordance with the Parent Policy, including respectful communication with staff, learners, and other parents, and adherence to school procedures.</li><li>Meet all financial obligations in accordance with the Fees Policy, including payment of school fees, notice periods, and any additional charges that may apply.</li></ul>'
    '<h3>3. Disciplinary and Administrative Matters</h3>'
    '<p>I/we acknowledge that:</p>'
    '<ul><li>Breaches of the Learner Code of Conduct or Parent Policy may result in disciplinary or corrective action as determined by the school.</li><li>Outstanding school fees may result in restrictions on access to reports, school activities, or continued attendance, in line with the Fees Policy.</li><li>Hibiscus Schools reserves the right to amend its policies when necessary, and such amendments will be communicated to parents/guardians.</li></ul>'
    '<h3>4. General</h3>'
    '<p>I/we confirm that this Agreement is binding for the duration of my/our child''s enrolment at Hibiscus Schools.</p>'
    '<h3>5. Learner and Parent Details</h3>'
    '<p>The learner, grade and parent(s)/guardian(s) are those named on this registration.</p>'
    '<h3>6. Signatures</h3>'
    '<p>I/we confirm acceptance of the above and agree to be bound by the policies of Hibiscus Schools.</p>'
    '<p><em>January 2026</em></p>',
    true, '/policies/2026/Parent-Acknowledgement-and-Agreement.pdf', 40, true);
end $$;
