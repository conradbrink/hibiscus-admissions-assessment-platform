-- The school is Hibiscus International Schools. The seeded wording said
-- "Hibiscus Schools"; every template a parent reads now carries the full
-- name. Agreements a parent has already signed keep the text they signed.
begin;

update public.email_templates
set subject = replace(subject, 'Hibiscus Schools', 'Hibiscus International Schools'),
    body_html = replace(body_html, 'Hibiscus Schools', 'Hibiscus International Schools'),
    body_text = replace(body_text, 'Hibiscus Schools', 'Hibiscus International Schools')
where subject like '%Hibiscus Schools%' or body_html like '%Hibiscus Schools%' or body_text like '%Hibiscus Schools%';

update public.offer_templates
set body_html = replace(body_html, 'Hibiscus Schools', 'Hibiscus International Schools'),
    terms_html = replace(terms_html, 'Hibiscus Schools', 'Hibiscus International Schools')
where body_html like '%Hibiscus Schools%' or terms_html like '%Hibiscus Schools%';

update public.message_templates
set body_preview = replace(body_preview, 'Hibiscus Schools', 'Hibiscus International Schools')
where body_preview like '%Hibiscus Schools%';

update public.agreement_templates t
set body_html = replace(body_html, 'Hibiscus Schools', 'Hibiscus International Schools'),
    description = replace(description, 'Hibiscus Schools', 'Hibiscus International Schools'),
    name = replace(name, 'Hibiscus Schools', 'Hibiscus International Schools')
where (body_html like '%Hibiscus Schools%' or description like '%Hibiscus Schools%' or name like '%Hibiscus Schools%')
  and not exists (select 1 from public.agreement_acceptances a where a.agreement_template_id = t.id);

commit;
