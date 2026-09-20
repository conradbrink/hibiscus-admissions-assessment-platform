-- Importing the school's other system's records: Ed-admin's students sheet
-- and its parents workbook, read by `web/lib/crm/ed-admin-import.ts`.
--
-- Three things the database has to know for that:
--
--  1. Two more kinds of import, so the preview and the history say which
--     file it was.
--  2. A student column on the import rows, because this import writes
--     children as well as families, and the row should say which child.
--  3. A family created from Ed-admin keeps Ed-admin's family code as its own.
--     The code is what the school bills by and what the two files share, so
--     `crm_create_family` takes an optional code. Given, it is used (and
--     refused if a live family already has it); absent, the next code is
--     minted as before.

-- 1. The kinds. The constraint was declared inline, so its name is found
--    rather than assumed.
do $$
declare
  v_name text;
begin
  select conname into v_name
    from pg_constraint
   where conrelid = 'public.crm_imports'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%kind%';
  if v_name is not null then
    execute format('alter table public.crm_imports drop constraint %I', v_name);
  end if;
end $$;

alter table public.crm_imports
  add constraint crm_imports_kind_check
  check (kind in ('families', 'contacts', 'ed_admin_parents', 'ed_admin_students'));

-- 2. The child a row wrote.
alter table public.crm_import_rows
  add column if not exists student_id uuid references public.students(id) on delete set null;

-- The Ed-admin family code, once the import has told us. Looked up on every
-- row of a students file.
create index if not exists families_external_ref_idx
  on public.families(external_ref) where external_ref is not null;

-- 3. `crm_create_family` with the code as a choice. Postgres would keep the
--    old signature alongside a new one and refuse every call as ambiguous,
--    so the old one goes first.
drop function if exists public.crm_create_family(text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text[], uuid, uuid, boolean, boolean, boolean, boolean);

create or replace function public.crm_create_family(
  p_display_name text,
  p_campus_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_mobile text,
  p_mobile_normalised text,
  p_relationship text default 'parent',
  p_lead_source text default null,
  p_lead_source_detail text default null,
  p_preferred_channel text default null,
  p_preferred_language text default null,
  p_home_address text default null,
  p_notes text default null,
  p_tags text[] default '{}',
  p_assigned_staff_id uuid default null,
  p_referred_by_family_id uuid default null,
  p_marketing_email boolean default false,
  p_marketing_whatsapp boolean default false,
  p_sms boolean default false,
  p_whatsapp_opt_in boolean default false,
  p_family_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_family uuid;
  v_contact uuid;
  v_email text := lower(trim(p_email));
  v_code text := nullif(upper(trim(coalesce(p_family_code, ''))), '');
begin
  if v_actor is null or not public.has_permission('crm.write') then
    raise exception 'permission_denied';
  end if;
  if p_campus_id is null or not public.can_access_campus(p_campus_id) then
    raise exception 'campus_not_allowed';
  end if;
  if exists (select 1 from public.contacts where email_normalised = v_email) then
    raise exception 'contact_email_exists';
  end if;
  if v_code is not null then
    if v_code !~ '^[A-Z0-9_-]{1,32}$' then
      raise exception 'family_code_invalid';
    end if;
    if exists (select 1 from public.families where family_code = v_code and merged_into_id is null)
       or exists (select 1 from public.contacts where family_code = v_code) then
      raise exception 'family_code_exists';
    end if;
  end if;

  insert into public.families (
    family_code, display_name, campus_id, home_address, notes,
    lead_source, lead_source_detail, preferred_channel, preferred_language,
    tags, assigned_staff_id, referred_by_family_id, source, created_by, external_ref
  ) values (
    coalesce(v_code, public.next_family_code(p_last_name)), nullif(trim(p_display_name), ''), p_campus_id, nullif(trim(p_home_address), ''), nullif(trim(p_notes), ''),
    p_lead_source, nullif(trim(p_lead_source_detail), ''), p_preferred_channel, nullif(trim(p_preferred_language), ''),
    coalesce(p_tags, '{}'), p_assigned_staff_id, p_referred_by_family_id, case when v_code is null then 'staff' else 'import' end, v_actor, v_code
  )
  returning id into v_family;

  -- The trigger on `contacts` copies the family's code onto the contact.
  insert into public.contacts (
    first_name, last_name, email, email_normalised, mobile, mobile_normalised,
    family_id, relationship,
    whatsapp_opt_in, whatsapp_opt_in_at, whatsapp_opt_in_source,
    marketing_email_consent, marketing_email_consent_at,
    marketing_whatsapp_consent, marketing_whatsapp_consent_at,
    sms_consent, sms_consent_at, consent_source
  ) values (
    trim(p_first_name), trim(p_last_name), trim(p_email), v_email, nullif(trim(p_mobile), ''), p_mobile_normalised,
    v_family, coalesce(p_relationship, 'parent'),
    coalesce(p_whatsapp_opt_in, false), case when p_whatsapp_opt_in then now() end, case when p_whatsapp_opt_in then 'staff' end,
    coalesce(p_marketing_email, false), case when p_marketing_email then now() end,
    coalesce(p_marketing_whatsapp, false), case when p_marketing_whatsapp then now() end,
    coalesce(p_sms, false), case when p_sms then now() end,
    case when p_marketing_email or p_marketing_whatsapp or p_sms then 'staff' end
  )
  returning id into v_contact;

  update public.families set primary_contact_id = v_contact where id = v_family;

  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, after)
  select 'staff', v_actor, sp.email, 'family.created', 'family', v_family,
         jsonb_build_object('display_name', p_display_name, 'campus_id', p_campus_id, 'contact_id', v_contact, 'family_code', v_code)
    from public.staff_profiles sp where sp.id = v_actor;

  insert into public.crm_trigger_events (type, family_id, payload)
  values ('family.created', v_family, jsonb_build_object('source', case when v_code is null then 'staff' else 'import' end));

  return v_family;
end;
$$;

revoke execute on function public.crm_create_family(text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text[], uuid, uuid, boolean, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.crm_create_family(text, uuid, text, text, text, text, text, text, text, text, text, text, text, text, text[], uuid, uuid, boolean, boolean, boolean, boolean, text) to authenticated;
