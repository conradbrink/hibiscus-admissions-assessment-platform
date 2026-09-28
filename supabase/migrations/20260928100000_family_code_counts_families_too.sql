-- The next family code counted only the codes on contacts.
--
-- A family whose contacts are gone (an applicant deleted after the family
-- was minted, a test record) keeps its code on `families`, and the live
-- families' codes are unique. The minter read `contacts` alone, so the
-- next family with the same three letters was handed a code a contactless
-- family already held, and the insert failed on the unique index. Found
-- when 116 event registrations were imported and the third "Mos…" family
-- collided with MOS0003.
--
-- Both tables are counted now. The lock, the padding and the shape of the
-- code are unchanged.

create or replace function public.next_family_code(p_last_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_n int;
begin
  v_prefix := upper(regexp_replace(coalesce(p_last_name, ''), '[^A-Za-z]', '', 'g'));
  v_prefix := rpad(left(v_prefix, 3), 3, 'X');

  perform pg_advisory_xact_lock(hashtext('family_code:' || v_prefix));

  select coalesce(max(n), 0) + 1 into v_n
    from (
      select substring(family_code from 4)::int as n
        from public.contacts
       where family_code ~ ('^' || v_prefix || '[0-9]+$')
      union all
      select substring(family_code from 4)::int
        from public.families
       where family_code ~ ('^' || v_prefix || '[0-9]+$')
    ) as codes;

  return v_prefix || lpad(v_n::text, 4, '0');
end;
$$;

revoke execute on function public.next_family_code(text) from public, anon, authenticated;
