-- The waiting-list email undercut its own good news and then left the parent
-- with nothing to do.
--
-- "{{student_first_name}} met our admission criteria. But {{grade}} at
-- {{campus}} is full at the moment." — the "But" turns the one piece of good
-- news into the setup for a refusal, and the child's name appeared four times
-- in five sentences. Worse, it answered none of what a waitlisted family
-- actually asks: is there anything I must do, how are places given out, and
-- what are my alternatives if we would rather not wait.
--
-- The new wording says how the list is worked through, and it says it because
-- that is what promoteWaitlist does: longest-waiting first, by the day the
-- decision was made. If that order ever changes, this email is a caller.
update email_templates
set is_active = false, updated_at = now()
where key = 'outcome_waitlisted' and is_active;

insert into email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
select
  t.key,
  t.version + 1,
  t.name,
  t.description,
  '{{student_first_name}}''s results, and a place on the waiting list',
  'Dear {{parent_first_name}},

Thank you for bringing {{student_first_name}} to the assessment. The learning profile is ready and is yours to keep, whatever happens next:
{{results_link}}

{{student_first_name}} met our admission criteria for {{grade}}. Every place in that class at {{campus}} is taken for the moment, so we have added {{student_first_name}} to the waiting list for it.

Places do come free — families move and plans change — and we work through the list in the order children joined it. There is nothing you need to do to stay on it, and it costs nothing to be there.

If you would rather not wait, reply to this email. We will tell you which of our other campuses have room in {{grade}}, or put {{student_first_name}} forward for the next intake.

Reference: {{application_reference}}

Warm regards,
Hibiscus International Schools Admissions',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>Thank you for bringing {{student_first_name}} to the assessment. The learning profile is ready and is yours to keep, whatever happens next:</p>'
  || '<p><a href="{{results_link}}">Read the learning profile</a></p>'
  || '<p>{{student_first_name}} met our admission criteria for {{grade}}. Every place in that class at {{campus}} is taken for the moment, so we have added {{student_first_name}} to the waiting list for it.</p>'
  || '<p>Places do come free — families move and plans change — and we work through the list in the order children joined it. There is nothing you need to do to stay on it, and it costs nothing to be there.</p>'
  || '<p>If you would rather not wait, reply to this email. We will tell you which of our other campuses have room in {{grade}}, or put {{student_first_name}} forward for the next intake.</p>'
  || '<p>Reference: {{application_reference}}</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  t.allowed_variables,
  true,
  t.audience
from email_templates t
where t.key = 'outcome_waitlisted'
  and t.version = (select max(version) from email_templates where key = 'outcome_waitlisted');
