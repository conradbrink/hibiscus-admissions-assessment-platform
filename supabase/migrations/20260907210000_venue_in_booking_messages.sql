-- Where the assessment is written. The booking messages named the campus
-- and the room but not the address or the phone number, so a parent with
-- the link still had to search for the school. Every campus carries its
-- address and phone lines (`campuses.address`, one line each), and the
-- booking confirmation, both reminders and the visit confirmation now print
-- them. The same messages are rewritten in plain English (CEFR B1 to B2)
-- while they are being republished. Nothing about when they send changes.
begin;

create function pg_temp.bump_email(p_key text, p_html text, p_text text, p_extra_vars text[]) returns void
language plpgsql as $$
declare v_next int;
begin
  select max(version) + 1 into v_next from public.email_templates where key = p_key;
  if v_next is null then raise exception 'template_key_unknown: %', p_key; end if;
  update public.email_templates set is_active = false where key = p_key and is_active;
  insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
  select key, v_next, name, description, subject, p_html, p_text,
         (select array_agg(distinct v) from unnest(allowed_variables || p_extra_vars) as v),
         true, audience
    from public.email_templates where key = p_key order by version desc limit 1;
end $$;

select pg_temp.bump_email('booking_confirmed',
  '<p>Dear {{parent_first_name}},</p><p><strong>{{student_first_name}}''s assessment is booked.</strong></p><table class="details"><tr><td>When</td><td>{{assessment_date}} at {{assessment_time}}</td></tr><tr><td>Where</td><td>{{campus}}{{#if location}}, {{location}}{{/if}}{{#if campus_address}}<br><span style="white-space:pre-line">{{campus_address}}</span>{{/if}}</td></tr><tr><td>Reference</td><td>{{application_reference}}</td></tr></table><p>Please arrive ten minutes early. At reception, give your name or the reference. There are no forms to fill in.</p><p>{{student_first_name}} does the assessment on a computer at the school. There is nothing to bring and nothing to prepare.</p><p><a href="{{next_step_link}}" class="button">View my booking</a></p><p>We look forward to meeting you both.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}}''s assessment is booked.\n\nWhen: {{assessment_date}} at {{assessment_time}}\nWhere: {{campus}}{{#if location}}, {{location}}{{/if}}\n{{#if campus_address}}{{campus_address}}\n{{/if}}Reference: {{application_reference}}\n\nPlease arrive ten minutes early. At reception, give your name or the reference. There are no forms to fill in.\n\n{{student_first_name}} does the assessment on a computer at the school. There is nothing to bring and nothing to prepare.\n\nYou can view or change your booking here:\n{{next_step_link}}\n\nWe look forward to meeting you both.\n\nHibiscus International Schools Admissions',
  array['campus_address']);

select pg_temp.bump_email('assessment_reminder_48h',
  '<p>Dear {{parent_first_name}},</p><p>A reminder: {{student_first_name}}''s assessment is on <strong>{{assessment_date}} at {{assessment_time}}</strong>.</p><table class="details"><tr><td>Where</td><td>{{campus}}{{#if location}}, {{location}}{{/if}}{{#if campus_address}}<br><span style="white-space:pre-line">{{campus_address}}</span>{{/if}}</td></tr></table><p>If you need to change the time, you can do it here:</p><p><a href="{{next_step_link}}" class="button">View my booking</a></p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nA reminder: {{student_first_name}}''s assessment is on {{assessment_date}} at {{assessment_time}}.\n\nWhere: {{campus}}{{#if location}}, {{location}}{{/if}}\n{{#if campus_address}}{{campus_address}}\n{{/if}}\nIf you need to change the time, you can do it here:\n{{next_step_link}}\n\nHibiscus International Schools Admissions',
  array['location', 'campus_address']);

select pg_temp.bump_email('assessment_reminder_day',
  '<p>Dear {{parent_first_name}},</p><p>{{student_first_name}}''s assessment is <strong>today at {{assessment_time}}</strong>.</p><table class="details"><tr><td>Where</td><td>{{campus}}{{#if location}}, {{location}}{{/if}}{{#if campus_address}}<br><span style="white-space:pre-line">{{campus_address}}</span>{{/if}}</td></tr><tr><td>Reference</td><td>{{application_reference}}</td></tr></table><p>At reception, give your name or the reference. See you soon.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}}''s assessment is today at {{assessment_time}}.\n\nWhere: {{campus}}{{#if location}}, {{location}}{{/if}}\n{{#if campus_address}}{{campus_address}}\n{{/if}}Reference: {{application_reference}}\n\nAt reception, give your name or the reference. See you soon.\n\nHibiscus International Schools Admissions',
  array['campus_address']);

select pg_temp.bump_email('visit_confirmed',
  '<p>Dear {{parent_first_name}},</p><p><strong>Your visit to {{campus}} is booked.</strong></p><table class="details"><tr><td>When</td><td>{{assessment_date}} at {{assessment_time}}</td></tr><tr><td>Where</td><td>{{campus}}{{#if location}}, {{location}}{{/if}}{{#if campus_address}}<br><span style="white-space:pre-line">{{campus_address}}</span>{{/if}}</td></tr><tr><td>Reference</td><td>{{application_reference}}</td></tr></table><p>At reception, give your name or the reference.</p><p><a href="{{next_step_link}}" class="button">View my booking</a></p><p>We look forward to showing you the school.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nYour visit to {{campus}} is booked.\n\nWhen: {{assessment_date}} at {{assessment_time}}\nWhere: {{campus}}{{#if location}}, {{location}}{{/if}}\n{{#if campus_address}}{{campus_address}}\n{{/if}}Reference: {{application_reference}}\n\nAt reception, give your name or the reference.\n\nYou can view or change your booking here:\n{{next_step_link}}\n\nWe look forward to showing you the school.\n\nHibiscus International Schools Admissions',
  array['location', 'campus_address']);

commit;
