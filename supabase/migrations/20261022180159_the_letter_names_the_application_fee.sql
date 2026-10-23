-- The offer letter names the application fee the way the fee schedule does.
--
-- Both letters printed a fixed "Application fee" beside `{{registration_fee}}`,
-- whatever the schedule called the line. On 22 October 2026 the school named
-- Potch's line the "2026/2027 admission fee"
-- (20261022103732_potch_admission_fee_2026_2027.sql); the parent's fee list
-- and the payment page print a line's own label, so the letter would have
-- been the one place still calling it something else.
--
-- `registration_fee_label` is the label frozen in the offer's fee snapshot
-- (web/lib/offers/snapshot.ts), so a letter drafted before a rename keeps the
-- name it was priced under. Every Botswana schedule calls the line
-- "Application fee", so their letters read exactly as before, and the
-- standard letter keeps its "(non-refundable)" after the name.
--
-- Apply this after the code that supplies the variable is live. The
-- renderer prints an allowed variable it is not given as nothing, so the
-- template on its own would print " (non-refundable)" with no name before it.
--
-- Active versions only: an older version is the template of offers already
-- frozen from it, and those keep their wording. Anchored on the exact row and
-- checked, because a `replace` that matches nothing says nothing about it.

do $$
declare
  v_std_old constant text := '<td>Application fee (non-refundable)</td><td>{{registration_fee}}</td>';
  v_std_new constant text := '<td>{{registration_fee_label}} (non-refundable)</td><td>{{registration_fee}}</td>';
  v_sch_old constant text := '<td>Application fee</td><td>{{registration_fee}}</td>';
  v_sch_new constant text := '<td>{{registration_fee_label}}</td><td>{{registration_fee}}</td>';
  v_missing text;
begin
  update public.offer_templates
     set body_html = replace(body_html, v_std_old, v_std_new),
         updated_at = now()
   where key = 'standard' and is_active
     and position(v_std_old in body_html) > 0;

  update public.offer_templates
     set body_html = replace(body_html, v_sch_old, v_sch_new),
         updated_at = now()
   where key = 'scholarship' and is_active
     and position(v_sch_old in body_html) > 0;

  update public.offer_templates
     set allowed_variables = array_append(allowed_variables, 'registration_fee_label'),
         updated_at = now()
   where key in ('standard', 'scholarship') and is_active
     and not ('registration_fee_label' = any (allowed_variables));

  -- Idempotent: a second run finds the new row and changes nothing. A letter
  -- carrying neither row has been reworded by hand and needs a person.
  select string_agg(t.key, ', ' order by t.key) into v_missing
    from public.offer_templates t
   where t.is_active and t.key in ('standard', 'scholarship')
     and position('{{registration_fee_label}}' in t.body_html) = 0
     and position('{{registration_fee}}' in t.body_html) > 0;
  if v_missing is not null then
    raise exception 'these active offer letters print the application fee without its name from the schedule; check the fee table by hand in Offer templates: %', v_missing;
  end if;

  raise notice 'the offer letters name the application fee as the fee schedule does';
end $$;
