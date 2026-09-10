-- Ed-admin's G1 Gender is a required column, and until now we had no field
-- for it: the exporter worked the sex out from the title, because the title
-- was the only thing on the record that carried one.
--
-- That works for Mr and Mrs and fails silently for the rest. A guardian who
-- is Dr, Professor, Reverend, Pastor or Other, with a relationship that does
-- not settle it either ("parent", "guardian"), exported with Relation and
-- Gender both blank — and Ed-admin rejects the row. Every field on the form
-- was filled in; nothing looked wrong until the import.
--
-- So it is asked for now, and the derivation stays only as the answer for
-- records written before this column existed.
alter table registration_contacts add column if not exists gender text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'registration_contacts_gender_check'
  ) then
    alter table registration_contacts
      add constraint registration_contacts_gender_check check (gender in ('F', 'M'));
  end if;
end $$;

comment on column registration_contacts.gender is
  'F or M, Ed-admin''s own values. Asked on the form; older rows are backfilled from the relationship, then the title, and stay null when neither says.';

-- Backfill what can be known without guessing. The relationship first, since
-- a mother is a mother whatever her title; then the titles that carry a sex.
-- A doctor who is a "parent" stays null rather than being guessed at, and the
-- export reports them the way it always did.
update registration_contacts
set gender = case
      when lower(relationship) in ('mother', 'stepmother', 'step-mother', 'grandmother', 'aunt', 'sister') then 'F'
      when lower(relationship) in ('father', 'stepfather', 'step-father', 'grandfather', 'brother') then 'M'
      when title in ('Mrs', 'Miss', 'Ms', 'Princess') then 'F'
      when title in ('Mr', 'Prince', 'Nkosi') then 'M'
    end,
    updated_at = now()
where gender is null
  and (
    lower(relationship) in ('mother', 'stepmother', 'step-mother', 'grandmother', 'aunt', 'sister',
                            'father', 'stepfather', 'step-father', 'grandfather', 'brother')
    or title in ('Mrs', 'Miss', 'Ms', 'Princess', 'Mr', 'Prince', 'Nkosi')
  );
