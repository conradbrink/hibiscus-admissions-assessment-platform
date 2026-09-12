-- Pre-school says play date, and never says assessment.
--
-- A child joining Nursery to Pre-Reception sits no assessment, and what they
-- come to is a play date — not a "visit", which is what a Form 2 family books
-- when they want to look around before applying. Both are stored as
-- `bookings.kind = 'visit'`; the word is chosen from
-- `applications.requires_assessment` (web/lib/booking/noun.ts).
--
-- Pre-school gets its own templates rather than neutered versions of the
-- assessment ones. `visit_confirmed` and `results_and_offer` are approved with
-- Zavu for the assessed track and stay exactly as they are: rewording an
-- approved template sends it back for approval, and it would still have to
-- carry both tracks' words.
--
-- What changes here:
--   playdate_confirmed            new pair, the pre-school `visit_confirmed`
--   preschool_offer               new pair, the pre-school `results_and_offer`
--   preschool_enquiry_received    reworded: "book a play date", no assessment
--   outcome_declined              branches on {{#if assessed}}
--   outcome_waitlisted            branches on {{#if assessed}}
--
-- The two outcomes are `email_only` — bad news is not delivered by
-- notification — so they branch rather than split, and need no Zavu round.
-- `assessed` and `no_assessment` are mirrors because the template language has
-- {{#if}} and no {{#unless}} (web/lib/email/render.ts), the shape
-- `all_received` already uses.

begin;

create function pg_temp.bump_email(p_key text, p_subject text, p_html text, p_text text, p_extra_vars text[]) returns void
language plpgsql as $$
declare v_next int;
begin
  select max(version) + 1 into v_next from public.email_templates where key = p_key;
  if v_next is null then raise exception 'template_key_unknown: %', p_key; end if;
  update public.email_templates set is_active = false where key = p_key and is_active;
  insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
  select key, v_next, name, description, p_subject, p_html, p_text,
         (select array_agg(distinct v) from unnest(allowed_variables || p_extra_vars) as v),
         true, audience
    from public.email_templates where key = p_key order by version desc limit 1;
end $$;

-- ---------------------------------------------------------------------------
-- The play date is booked
-- ---------------------------------------------------------------------------

-- Modelled on `visit_confirmed`, with the directions line already in it: the
-- maps migration splices that into templates that existed when it ran, and
-- this one arrives after.
insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
values (
  'playdate_confirmed',
  1,
  'Play date booked',
  'Sent when a pre-school family books a play date. The pre-school counterpart of the visit confirmation.',
  '{{student_first_name}}''s play date at {{campus}} is booked — {{assessment_date}} at {{assessment_time}}',
  '<p>Dear {{parent_first_name}},</p><p><strong>{{student_first_name}}''s play date at {{campus}} is booked.</strong></p><table class="details"><tr><td>When</td><td>{{assessment_date}} at {{assessment_time}}</td></tr><tr><td>Where</td><td>{{campus}}{{#if location}}, {{location}}{{/if}}{{#if campus_address}}<br><span style="white-space:pre-line">{{campus_address}}</span>{{#if campus_maps_url}}<br><a href="{{campus_maps_url}}">Get directions</a>{{/if}}{{/if}}</td></tr><tr><td>Reference</td><td>{{application_reference}}</td></tr></table><p>At reception, give your name or the reference.</p><p>{{student_first_name}} can play, meet the teachers and see the room. There is nothing to prepare and nothing to bring. Stay as long as you like and ask us anything.</p><p><a href="{{next_step_link}}" class="button">View my booking</a></p><p>We look forward to meeting you both.</p><p>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n{{student_first_name}}''s play date at {{campus}} is booked.\n\nWhen: {{assessment_date}} at {{assessment_time}}\nWhere: {{campus}}{{#if location}}, {{location}}{{/if}}\n{{#if campus_address}}{{campus_address}}{{#if campus_maps_url}}\nDirections: {{campus_maps_url}}{{/if}}\n{{/if}}Reference: {{application_reference}}\n\nAt reception, give your name or the reference.\n\n{{student_first_name}} can play, meet the teachers and see the room. There is nothing to prepare and nothing to bring. Stay as long as you like and ask us anything.\n\nYou can view or change your booking here:\n{{next_step_link}}\n\nWe look forward to meeting you both.\n\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','campus','assessment_date','assessment_time','location','campus_address','campus_maps_url','application_reference','next_step_link'],
  true,
  'parent'
)
on conflict (key, version) do nothing;

-- Inactive with no provider id, like every companion before approval.
-- `message_templates_check` refuses an active row without one, so this appears
-- greyed out in Set up → WhatsApp templates until Zavu approves the wording
-- and somebody pastes the id in. Until then the moment goes by email alone.
insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'playdate_confirmed',
  'Play date booked',
  'en',
  E'Hi {{1}}, {{2}}''s play date at {{3}} is booked for {{4}} at {{5}}. Your reference is {{6}} — give your name or the reference at reception. Tap below to view or change it.',
  array['parent_first_name','student_first_name','campus','assessment_date','assessment_time','application_reference'],
  true,
  'next_step',
  false,
  'applicant'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The pre-school offer
-- ---------------------------------------------------------------------------

-- `results_and_offer` opens by thanking the parent for bringing the child to
-- be assessed and leads with the learning profile. A pre-school family has
-- neither, and `onOfferSent` already omits the results link for them — so the
-- email that arrived promised a profile the link could not reach.
insert into public.email_templates (key, version, name, description, subject, body_html, body_text, allowed_variables, is_active, audience)
values (
  'preschool_offer',
  1,
  'Pre-school offer of a place',
  'Sent when an offer is approved for a child who sits no assessment. No results and no learning profile.',
  '{{student_first_name}} — an offer of a place at {{campus}}',
  '<p>Dear {{parent_first_name}},</p><p>We are delighted to offer <strong>{{student_first_name}}</strong> a place at <strong>{{campus}}</strong> in <strong>{{grade}}</strong>.</p>{{#if promotion_text}}<p><strong>Your welcome offer:</strong> {{promotion_text}}.</p>{{/if}}<p><a href="{{offer_link}}" class="button">Read the offer</a></p><p>The offer is open until <strong>{{offer_expiry_date}}</strong>.{{#if amount_due}} The fees to pay when you accept are {{amount_due}}.{{/if}}</p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nWe are delighted to offer {{student_first_name}} a place at {{campus}} in {{grade}}.\n\n{{#if promotion_text}}Your welcome offer: {{promotion_text}}.\n\n{{/if}}Please read the offer here:\n{{offer_link}}\n\nThe offer is open until {{offer_expiry_date}}.{{#if amount_due}} The fees to pay when you accept are {{amount_due}}.{{/if}}\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions',
  array['parent_first_name','student_first_name','campus','grade','application_reference','offer_link','offer_expiry_date','amount_due','promotion_text','next_step_link'],
  true,
  'parent'
)
on conflict (key, version) do nothing;

insert into public.message_templates (key, name, language, body_preview, parameters, button_link, link_purpose, is_active, audience)
values (
  'preschool_offer',
  'Pre-school offer of a place',
  'en',
  E'Hi {{1}}, we are delighted to offer {{2}} a place at {{3}}. Tap below to read the offer and accept it.',
  array['parent_first_name','student_first_name','campus'],
  true,
  'offer',
  false,
  'applicant'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The enquiry, reworded
-- ---------------------------------------------------------------------------

-- Said "book a visit" and reassured the parent there is no assessment. The
-- reassurance is dropped rather than reworded: a family who was never going to
-- be assessed does not need the word introduced in order to be told it does
-- not apply. What replaces it is what does happen.
select pg_temp.bump_email('preschool_enquiry_received',
  'We''ve received your enquiry for {{student_first_name}}',
  '<p>Dear {{parent_first_name}},</p><p>Thank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.</p><p>Your reference is <strong>{{application_reference}}</strong>.</p><p>Our admissions team will check whether there is a place and come back to you. If you would like to see the campus first, you can book a play date:</p><p><a href="{{next_step_link}}">Book a play date</a></p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\nThank you for your interest in Hibiscus International Schools. We received your enquiry for {{student_first_name}} to join {{campus}} in {{grade}}.\n\nYour reference is {{application_reference}}.\n\nOur admissions team will check whether there is a place and come back to you. If you would like to see the campus first, you can book a play date here:\n{{next_step_link}}\n\nWarm regards,\nHibiscus International Schools Admissions',
  -- The email does not print the number — a parent can reply to it, and that
  -- inbox is read. The variable is allowed here because the WhatsApp
  -- companion's parameters must be a subset of this list
  -- (lib/messaging/template-checks.ts), and the companion does print it.
  array['campus_whatsapp']);

-- The companion's preview follows the wording submitted to Zavu for
-- re-approval. Zavu keeps sending the wording it has approved until that
-- lands, so for a short while the preview here is ahead of what a parent
-- reads — which is the right way round: the record shows what was asked for,
-- and the id does not change.
--
-- It also names the number to message. The WhatsApp number these go out from
-- is not manned, so "come back to you" on a channel a parent can reply to was
-- an invitation to be ignored. The campus's own WhatsApp number is a variable
-- rather than a constant: Potch is a South African number and every Botswana
-- campus shares one, and a family told to message the wrong country messages
-- nobody.
update public.message_templates
   set body_preview = E'Hi {{1}}, thank you for your enquiry for {{2}} to join {{3}}. Your reference is {{4}}. Our admissions team will check availability and come back to you. Tap below if you would like to book a play date and see the campus first, or message us on {{5}}.',
       parameters = array['parent_first_name','student_first_name','campus','application_reference','campus_whatsapp']
 where key = 'preschool_enquiry_received';

-- ---------------------------------------------------------------------------
-- The two outcomes, branched
-- ---------------------------------------------------------------------------

-- A pre-school family that is turned down was reading a subject line saying
-- "assessment results" above a letter thanking them for bringing their child
-- to an assessment that never happened. Both branches are written out rather
-- than made generic: a family that did sit an assessment should still be
-- thanked for it.
select pg_temp.bump_email('outcome_declined',
  '{{#if assessed}}{{student_first_name}} — assessment results{{/if}}{{#if no_assessment}}{{student_first_name}} — your application to Hibiscus{{/if}}',
  '<p>Dear {{parent_first_name}},</p>{{#if assessed}}<p>Thank you for bringing {{student_first_name}} to the assessment, and for your interest in Hibiscus International Schools.</p>{{/if}}{{#if no_assessment}}<p>Thank you for your interest in Hibiscus International Schools, and for thinking of us for {{student_first_name}}.</p>{{/if}}<p>We are sorry. We cannot offer {{student_first_name}} a place in {{grade}} at {{campus}} this time.</p>{{#if results_link}}<p>{{student_first_name}}''s learning profile is ready. It shows strengths and areas to develop. We hope it helps you, whatever you decide next.</p><p><a href="{{results_link}}" class="button">View learning profile</a></p>{{/if}}<p>If you would like to talk this through, reply to this email. A member of our admissions team will contact you.</p><p>Reference: {{application_reference}}</p><p>With best wishes,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n{{#if assessed}}Thank you for bringing {{student_first_name}} to the assessment, and for your interest in Hibiscus International Schools.{{/if}}{{#if no_assessment}}Thank you for your interest in Hibiscus International Schools, and for thinking of us for {{student_first_name}}.{{/if}}\n\nWe are sorry. We cannot offer {{student_first_name}} a place in {{grade}} at {{campus}} this time.\n\n{{#if results_link}}{{student_first_name}}''s learning profile is ready. It shows strengths and areas to develop. We hope it helps you, whatever you decide next:\n{{results_link}}\n\n{{/if}}If you would like to talk this through, reply to this email. A member of our admissions team will contact you.\n\nReference: {{application_reference}}\n\nWith best wishes,\nHibiscus International Schools Admissions',
  array['assessed','no_assessment']);

-- The waiting-list letter led with the learning profile and its link, which a
-- pre-school family has none of: the link renders empty and the sentence
-- promises a page that is not there. The whole opening moves inside the
-- branch, so each family reads one written for them.
select pg_temp.bump_email('outcome_waitlisted',
  '{{#if assessed}}{{student_first_name}}''s results, and a place on the waiting list{{/if}}{{#if no_assessment}}{{student_first_name}} — a place on the waiting list{{/if}}',
  '<p>Dear {{parent_first_name}},</p>{{#if assessed}}<p>Thank you for bringing {{student_first_name}} to the assessment. The learning profile is ready and is yours to keep, whatever happens next.</p><p><a href="{{results_link}}" class="button">View learning profile</a></p><p>{{student_first_name}} met our admission criteria for {{grade}}. Every place in that class at {{campus}} is taken for the moment, so we have added {{student_first_name}} to the waiting list for it.</p>{{/if}}{{#if no_assessment}}<p>Thank you for your interest in Hibiscus International Schools, and for thinking of us for {{student_first_name}}.</p><p>We would be glad to welcome {{student_first_name}} to {{grade}} at {{campus}}. Every place is taken for the moment, so we have added {{student_first_name}} to the waiting list for it.</p>{{/if}}<p>Places do come free — families move and plans change — and we work through the list in the order children joined it. There is nothing you need to do to stay on it, and it costs nothing to be there.</p><p>If you would rather not wait, reply to this email. We will tell you which of our other campuses have room in {{grade}}, or put {{student_first_name}} forward for the next intake.</p><p>Reference: {{application_reference}}</p><p>Warm regards,<br>Hibiscus International Schools Admissions</p>',
  E'Dear {{parent_first_name}},\n\n{{#if assessed}}Thank you for bringing {{student_first_name}} to the assessment. The learning profile is ready and is yours to keep, whatever happens next:\n{{results_link}}\n\n{{student_first_name}} met our admission criteria for {{grade}}. Every place in that class at {{campus}} is taken for the moment, so we have added {{student_first_name}} to the waiting list for it.\n{{/if}}{{#if no_assessment}}Thank you for your interest in Hibiscus International Schools, and for thinking of us for {{student_first_name}}.\n\nWe would be glad to welcome {{student_first_name}} to {{grade}} at {{campus}}. Every place is taken for the moment, so we have added {{student_first_name}} to the waiting list for it.\n{{/if}}\nPlaces do come free — families move and plans change — and we work through the list in the order children joined it. There is nothing you need to do to stay on it, and it costs nothing to be there.\n\nIf you would rather not wait, reply to this email. We will tell you which of our other campuses have room in {{grade}}, or put {{student_first_name}} forward for the next intake.\n\nReference: {{application_reference}}\n\nWarm regards,\nHibiscus International Schools Admissions',
  array['assessed','no_assessment']);

commit;
