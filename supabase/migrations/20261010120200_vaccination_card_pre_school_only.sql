-- ---------------------------------------------------------------------------
-- The vaccination card is asked of the pre-schools only
-- ---------------------------------------------------------------------------

-- The school asked on 10 October 2026 to stop asking Reception, primary and
-- secondary families to upload a vaccination card. Pre-school still needs it.
--
-- The cut is after Pre-Reception (sort order 40), the last pre-school grade;
-- Reception is 50. The row is narrowed, not deleted: cards already uploaded
-- keep their requirement, and a registration in progress stops counting it
-- as missing at once, because completeness is computed from the band every
-- time.
update public.document_requirements
   set grade_sort_max = 40
 where code = 'vaccination_card'
   and grade_sort_max is distinct from 40;

do $$
begin
  if exists (select 1 from public.required_document_codes(50) c where c = 'vaccination_card')
     or exists (select 1 from public.required_document_codes(60) c where c = 'vaccination_card')
     or exists (select 1 from public.required_document_codes(130) c where c = 'vaccination_card') then
    raise exception 'the vaccination card is still asked of Reception, primary or secondary';
  end if;
  if not exists (select 1 from public.required_document_codes(10) c where c = 'vaccination_card')
     or not exists (select 1 from public.required_document_codes(40) c where c = 'vaccination_card') then
    raise exception 'the vaccination card is no longer asked of pre-school';
  end if;
end $$;
