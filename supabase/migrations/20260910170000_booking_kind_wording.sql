-- A parent who booked a look around the campus was told their assessment was
-- confirmed. The appointment's noun is now a variable, so one template serves
-- both moments: a second set of templates would mean a second Meta approval
-- for every WhatsApp companion, for the sake of one word.
--
-- {{assessment_date}} and {{assessment_time}} keep their names — they are the
-- date and time of whichever appointment it is — so they are set aside before
-- the word is swapped and put back afterwards.
with protected as (
  select
    id,
    replace(replace(subject,   '{{assessment_date}}', '~~D~~'), '{{assessment_time}}', '~~T~~') as s,
    replace(replace(body_text, '{{assessment_date}}', '~~D~~'), '{{assessment_time}}', '~~T~~') as bt,
    replace(replace(body_html, '{{assessment_date}}', '~~D~~'), '{{assessment_time}}', '~~T~~') as bh
  from email_templates
  where is_active
    and key in ('booking_confirmed', 'assessment_reminder_48h', 'assessment_reminder_day',
                'no_show_reschedule', 'rebook_nudge')
)
update email_templates t
set subject   = replace(replace(replace(p.s,  'assessment', '{{booking_kind}}'), '~~D~~', '{{assessment_date}}'), '~~T~~', '{{assessment_time}}'),
    body_text = replace(replace(replace(p.bt, 'assessment', '{{booking_kind}}'), '~~D~~', '{{assessment_date}}'), '~~T~~', '{{assessment_time}}'),
    body_html = replace(replace(replace(p.bh, 'assessment', '{{booking_kind}}'), '~~D~~', '{{assessment_date}}'), '~~T~~', '{{assessment_time}}'),
    allowed_variables = (
      select array_agg(distinct v order by v)
      from unnest(t.allowed_variables || array['booking_kind']) as v
    ),
    updated_at = now()
from protected p
where p.id = t.id;
