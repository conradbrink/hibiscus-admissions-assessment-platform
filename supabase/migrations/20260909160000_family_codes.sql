-- A code that identifies a family, and never changes.
--
-- The school's other system bills a family, not a child: two siblings must
-- land on one account so the statement is one statement. That only works if
-- the code we export is the same code every time — for the second child, for
-- next year's export, and after a re-download of an old batch. So it is
-- stored on the contact the moment the family first appears, and nothing
-- rewrites it afterwards.
--
-- Shape follows the school's template ("AAA1"): three letters from the
-- family's surname, then a number that makes it unique. COE1, COE2 for two
-- unrelated Coetzer families. Readable on a statement, which is the point —
-- a UUID would be correct and useless.

alter table public.contacts
  add column if not exists family_code text;

-- Indexed, deliberately NOT unique. A code identifies a family, and a family
-- can be two contacts: a mother who enquired for one child and a father who
-- enquired for another are merged onto one code precisely so the school sends
-- one statement. Minting is kept collision-free by the lock in
-- `next_family_code` instead.
create index if not exists contacts_family_code_idx
  on public.contacts(family_code)
  where family_code is not null;

comment on column public.contacts.family_code is
  'Stable identifier for the family in the school''s student system. Assigned once and never changed: siblings share it, so their fees land on one account.';

-- ---------------------------------------------------------------------------
-- Minting
-- ---------------------------------------------------------------------------

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
  -- Letters only, so "O'Brien" and "van der Merwe" give OBR and VAN rather
  -- than something with punctuation in it. A name with fewer than three
  -- letters is padded; a name with none at all becomes XXX.
  v_prefix := upper(regexp_replace(coalesce(p_last_name, ''), '[^A-Za-z]', '', 'g'));
  v_prefix := rpad(left(v_prefix, 3), 3, 'X');

  -- Two families enrolling at the same moment must not be handed the same
  -- code. The lock is per prefix and lasts to the end of the transaction.
  perform pg_advisory_xact_lock(hashtext('family_code:' || v_prefix));

  select coalesce(max(substring(family_code from 4)::int), 0) + 1
    into v_n
    from public.contacts
   where family_code ~ ('^' || v_prefix || '[0-9]+$');

  return v_prefix || v_n::text;
end;
$$;

revoke execute on function public.next_family_code(text) from public, anon, authenticated;

comment on function public.next_family_code(text) is
  'The next free family code for a surname. Locks per prefix so concurrent enquiries cannot collide.';

-- Every family gets one as it arrives, so nothing has to remember to do it
-- later and no export ever meets a family without a code.
create or replace function public.contacts_set_family_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.family_code is null then
    new.family_code := public.next_family_code(new.last_name);
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_set_family_code on public.contacts;
create trigger contacts_set_family_code
  before insert on public.contacts
  for each row execute function public.contacts_set_family_code();

-- The code is set once. Letting it change would split a family's history
-- across two accounts in the other system, silently.
create or replace function public.contacts_family_code_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.family_code is not null
     and new.family_code is distinct from old.family_code
     -- One deliberate exception, below: joining two halves of one family.
     and coalesce(current_setting('app.family_code_merge', true), '') <> 'on' then
    raise exception 'A family code cannot be changed once it has been given out (%). Use merge_family_code() to join two halves of one family.', old.family_code;
  end if;
  -- Filling in a missing one is allowed; that is the backfill.
  if new.family_code is null then
    new.family_code := old.family_code;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_family_code_immutable on public.contacts;
create trigger contacts_family_code_immutable
  before update on public.contacts
  for each row execute function public.contacts_family_code_immutable();

-- ---------------------------------------------------------------------------
-- Joining two halves of one family
-- ---------------------------------------------------------------------------

-- A mother who enquires for one child and a father who enquires for another
-- are two contacts, so two codes, so two accounts — and one family getting
-- two statements. This is the one sanctioned way to put that right: point the
-- second contact at the first one's code. Everything already exported keeps
-- the code it was exported with, so the school's other system has to be told
-- about the merge as well; the runbook says so.
create or replace function public.merge_family_code(p_contact_id uuid, p_into_code text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
begin
  if not exists (select 1 from public.contacts where family_code = p_into_code) then
    raise exception 'No family has the code %.', p_into_code;
  end if;
  select family_code into v_old from public.contacts where id = p_contact_id;
  if not found then
    raise exception 'No contact %.', p_contact_id;
  end if;
  if v_old = p_into_code then
    return p_into_code;
  end if;

  perform set_config('app.family_code_merge', 'on', true);
  update public.contacts set family_code = p_into_code where id = p_contact_id;
  perform set_config('app.family_code_merge', 'off', true);
  return p_into_code;
end;
$$;

revoke execute on function public.merge_family_code(uuid, text) from public, anon, authenticated;

comment on function public.merge_family_code(uuid, text) is
  'Points one contact at another family''s code, for two parents who enquired separately. The only sanctioned way past the immutability trigger; service role only.';

-- ---------------------------------------------------------------------------
-- Everyone already here
-- ---------------------------------------------------------------------------

do $backfill$
declare
  r record;
begin
  for r in select id, last_name from public.contacts where family_code is null order by created_at, id loop
    update public.contacts set family_code = public.next_family_code(r.last_name) where id = r.id;
  end loop;
end
$backfill$;
