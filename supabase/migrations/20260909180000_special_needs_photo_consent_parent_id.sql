-- Three things the school asked for while using the system.
--
--  1. A parent can say at the start that their child has additional needs, so
--     the assessment is arranged properly rather than discovered on the day.
--  2. Permission to photograph a child for social media, asked as its own
--     consent a parent may decline — not folded into a policy they have to
--     accept to enrol.
--  3. A parent's own identity document, alongside the child's.

-- ---------------------------------------------------------------------------
-- 1. Additional needs, asked at the start
-- ---------------------------------------------------------------------------

alter table public.applications
  add column if not exists has_special_needs boolean not null default false,
  add column if not exists special_needs_detail text;

comment on column public.applications.has_special_needs is
  'The family said at enquiry that the child has additional needs. A flag for arranging the sitting — never an input to any admission decision.';
comment on column public.applications.special_needs_detail is
  'What the family told us, in their words. Shown to staff arranging the assessment.';

-- ---------------------------------------------------------------------------
-- 2. Photography consent
-- ---------------------------------------------------------------------------

-- Its own agreement, and `required` false: a family that says no to
-- photographs still enrols, and the school has a dated record of the answer
-- either way. Burying it inside a policy the parent must accept would make it
-- a condition of joining, which is not consent.
insert into public.agreement_templates (key, version, name, description, body_html, required, is_active)
values (
  'photography_consent',
  1,
  'Photographs and social media',
  'Optional. Asked once during registration; a family may say no and still enrol, and may change their mind by telling the school.',
  '<h2>Photographs and social media</h2>' ||
  '<p>From time to time we photograph and film children at school — in class, on the field, at assemblies, concerts, sports days and outings — and we use those pictures to show families and the wider public what life at Hibiscus is like.</p>' ||
  '<p>That includes our website, our printed and emailed newsletters, prospectuses and displays around the school, and our social media accounts, which today are Facebook, Instagram and WhatsApp channels for parents.</p>' ||
  '<p><strong>By ticking this you agree that your child may be photographed or filmed, and that those pictures may be published in the places listed above.</strong></p>' ||
  '<ul>' ||
  '<li>We never publish your child''s full name beside a photograph, their class list, or any contact detail.</li>' ||
  '<li>We do not sell photographs, and we do not pass them to anyone outside the school for their own use.</li>' ||
  '<li>Once a picture is public on a social media platform, other people may copy or share it. We cannot undo that, which is why we ask before publishing rather than afterwards.</li>' ||
  '<li>You may say no now, or change your mind at any time by telling the school office in writing. We will stop using new pictures at once and remove existing ones from our own website and accounts where we still can.</li>' ||
  '<li>Saying no changes nothing about your child''s place, their lessons, or how they are treated. Staff simply keep them out of the frame.</li>' ||
  '</ul>' ||
  '<p>This consent is not needed for photographs the school keeps internally — a class photograph in a register, or a picture on your child''s own school record.</p>',
  false,
  true
)
on conflict (key, version) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The parent's own identity document
-- ---------------------------------------------------------------------------

insert into public.document_requirements (code, label, description, required, grade_sort_min, grade_sort_max, sort_order)
values (
  'parent_id',
  'Parent or guardian ID',
  'A copy of the Omang or passport of the parent or guardian who is registering the child. One is enough; if two guardians are on the account, either may be used.',
  true,
  null,
  null,
  15
)
on conflict (code) do update set
  label = excluded.label,
  description = excluded.description,
  required = excluded.required,
  sort_order = excluded.sort_order,
  is_active = true;
