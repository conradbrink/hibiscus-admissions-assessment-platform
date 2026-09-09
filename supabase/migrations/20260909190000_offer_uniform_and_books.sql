-- Offer letter: uniform and books are not in the fees.
--
-- Data only, and a new version rather than an edit: every offer already sent
-- keeps the words it was sent with. The sentence goes directly under the fee
-- table, where a parent is looking at the total and forming their idea of
-- what the year costs — which is the moment the omission matters.

do $offer$
declare
  v_body text;
  v_new text;
  v_anchor text := '</table>{{#if conditions}}';
  v_line text := '</table><p>These fees cover tuition. <strong>School uniform and books are not included</strong>; the school invoices for them separately, and will tell you what is needed and what it costs before the term begins.</p>{{#if conditions}}';
begin
  select body_html into v_body from public.offer_templates where key = 'standard' order by version desc limit 1;
  if v_body is null then
    raise exception 'No standard offer template to build on.';
  end if;

  -- Already carries it (a re-run, or somebody added it by hand): nothing to do.
  if position('uniform' in lower(v_body)) > 0 then
    return;
  end if;

  v_new := replace(v_body, v_anchor, v_line);
  -- A replace that matched nothing would leave the letter unchanged while the
  -- migration reported success, which is the worst of both.
  if v_new = v_body then
    raise exception 'The offer letter no longer contains %; add the uniform and books sentence by hand in Settings.', v_anchor;
  end if;

  update public.offer_templates set is_active = false where key = 'standard' and is_active;

  insert into public.offer_templates (key, version, name, description, body_html, terms_html, allowed_variables, is_active)
  select
    'standard',
    (select coalesce(max(version), 0) + 1 from public.offer_templates where key = 'standard'),
    t.name,
    t.description,
    v_new,
    t.terms_html,
    t.allowed_variables,
    true
  from public.offer_templates t
  where t.key = 'standard'
  order by t.version desc
  limit 1;
end
$offer$;
