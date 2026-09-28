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
-- Both tables are counted now. The lock and the shape of the code are
-- unchanged.
--
-- The suffix is read as `numeric`, not `int`: an Ed-admin family keeps its
-- own code through `crm_create_family(p_family_code)`, and nothing bounds
-- how many digits that code carries, so a long imported suffix must not
-- overflow the cast and stop every later code for that prefix. And the
-- padding only ever adds zeroes: `lpad()` truncates a string longer than
-- its target, so once a prefix passes 9999 the next code kept its four
-- leading characters and collided. The number is left whole now.

create or replace function public.next_family_code(p_last_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prefix text;
  v_n numeric;
  v_digits text;
begin
  v_prefix := upper(regexp_replace(coalesce(p_last_name, ''), '[^A-Za-z]', '', 'g'));
  v_prefix := rpad(left(v_prefix, 3), 3, 'X');

  perform pg_advisory_xact_lock(hashtext('family_code:' || v_prefix));

  select coalesce(max(n), 0) + 1 into v_n
    from (
      select substring(family_code from 4)::numeric as n
        from public.contacts
       where family_code ~ ('^' || v_prefix || '[0-9]+$')
      union all
      select substring(family_code from 4)::numeric
        from public.families
       where family_code ~ ('^' || v_prefix || '[0-9]+$')
    ) as codes;

  v_digits := v_n::text;
  return v_prefix || lpad(v_digits, greatest(4, length(v_digits)), '0');
end;
$$;

-- The formatting, checked without touching a row: a suffix past four digits
-- is kept whole, and a long imported suffix does not overflow.
do $$
begin
  if lpad((10000::numeric)::text, greatest(4, length((10000::numeric)::text)), '0') <> '10000' then
    raise exception 'next_family_code: a five-digit suffix must not be truncated';
  end if;
  if ('123456789012345678901'::numeric + 1)::text <> '123456789012345678902' then
    raise exception 'next_family_code: a long suffix must survive the numeric cast';
  end if;
end;
$$;

revoke execute on function public.next_family_code(text) from public, anon, authenticated;
