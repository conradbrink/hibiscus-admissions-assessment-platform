-- A fee can be charged by the month.
--
-- Potchefstroom prices by the month over eleven months, which is how the
-- school advertises it and how a parent thinks about it. Until now a fee line
-- could only be a year or a term, so the monthly figure had to be written
-- into a label — invisible to the letter, and impossible to add up.
--
-- `tuition_month` sits beside the other two. A schedule may carry a monthly
-- line, an annual one, or both: Potch shows the month a family pays and the
-- year it comes to, because either on its own leaves a question.
--
-- Nothing about what secures a place changes. Monthly tuition is invoiced,
-- never payable at acceptance, exactly as the annual and term lines are.

alter table public.fee_lines
  drop constraint if exists fee_lines_code_check;

alter table public.fee_lines
  add constraint fee_lines_code_check
  check (code = any (array['registration', 'admission', 'tuition_annual', 'tuition_term', 'tuition_month']));

comment on column public.fee_lines.code is
  'What the line is: registration and admission secure the place; tuition_month, tuition_term and tuition_annual are invoiced. A schedule may carry more than one tuition line where the school quotes more than one (a monthly price and the year it adds up to).';

-- ---------------------------------------------------------------------------
-- The letter shows it
-- ---------------------------------------------------------------------------

-- A new version of the standard offer, so every letter already sent keeps its
-- own words. The monthly row sits above the annual one, because the monthly
-- figure is the one a family compares and budgets against; both print only
-- when the schedule carries them, so nothing changes for a campus that
-- charges by the term.
do $offer$
declare
  v_body text;
  v_new text;
  v_vars text[];
  v_anchor text := '{{#if tuition_annual}}';
  v_row text := '{{#if tuition_month}}<tr><td>Tuition per month</td><td>{{tuition_month}}</td></tr>{{/if}}{{#if tuition_annual}}';
begin
  select body_html, allowed_variables into v_body, v_vars
    from public.offer_templates where key = 'standard' order by version desc limit 1;
  if v_body is null then
    raise exception 'No standard offer template to build on.';
  end if;
  if position('tuition_month' in v_body) > 0 then
    return;
  end if;

  v_new := replace(v_body, v_anchor, v_row);
  if v_new = v_body then
    raise exception 'The offer letter no longer contains %; add the monthly tuition row by hand in Settings.', v_anchor;
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
    -- The variable has to be allowed as well, or the renderer refuses it.
    (select array(select distinct unnest(v_vars || array['tuition_month']))),
    true
  from public.offer_templates t
  where t.key = 'standard'
  order by t.version desc
  limit 1;
end
$offer$;
