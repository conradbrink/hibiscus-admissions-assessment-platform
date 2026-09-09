-- Deleting an applicant outright, and only a super administrator may.
--
-- Everything else in this system is append-only on purpose: a decision is
-- superseded rather than edited, a withdrawal is a status rather than a
-- removal, and a family that asks to be forgotten is anonymised by
-- `anonymise_application`, which keeps the shape of the funnel for analytics
-- while removing the person. Those are the right tools almost always.
--
-- What none of them do is get rid of a record that should never have existed:
-- a duplicate created by a parent who filled the form twice, a test applicant
-- typed in during training, a walk-in entered against the wrong family. Those
-- rows are noise — they sit in the pipeline, they count in the analytics, and
-- staff work around them. Until now the only way to remove one was a hand
-- written SQL statement, which is worse than a button: unaudited, unscoped,
-- and one typo away from deleting the wrong row.
--
-- So: a button, with the whole weight of the system behind the check.
--
--   * a permission of its own, `applications.delete`, held by the super
--     administrator alone — not by `applications.write`, which every
--     admissions officer has;
--   * one function that does the deleting, service role only, so no policy,
--     no client and no other action can reach it;
--   * an audit row written before the delete and left behind afterwards, so
--     what was removed and by whom outlives the record itself.
--
-- It is not the tool for a data-protection erasure request. That is
-- `anonymise_application`: it leaves the counts intact, and it is what the
-- retention runbook points at. The difference is written into the console.

-- ---------------------------------------------------------------------------
-- The permission
-- ---------------------------------------------------------------------------

insert into public.permissions (code, label, sort_order) values
  ('applications.delete', 'Delete an applicant and everything attached to them', 25)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

-- The super administrator alone. `admin` already satisfies every check, so
-- this is the matrix saying out loud what is otherwise implicit — and it is
-- the row an administrator would have to tick to give the power to anybody
-- else, which is a deliberate act rather than a side effect of another role.
insert into public.role_permissions (role_id, permission_code)
select r.id, 'applications.delete'
from public.roles r
where r.code = 'super_admin'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The one exception to append-only decisions
-- ---------------------------------------------------------------------------

-- Admission decisions refuse both update and delete, which would stop the
-- cascade below dead. Rather than disabling the trigger — a lock on the whole
-- table, felt by every other session — the refusal now has one narrow escape:
-- a transaction-local flag that only `delete_application` sets, and only
-- around its own delete. An update is still refused, always: a decision that
-- can be rewritten is not a record of anything.
create or replace function public.admission_decisions_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.deleting_application', true), '') = 'on' then
    return old;
  end if;
  raise exception 'Admission decisions are append-only. Record a new decision with a reason.';
end;
$$;

revoke all on function public.admission_decisions_immutable() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The delete itself
-- ---------------------------------------------------------------------------

-- Everything hanging off an application cascades (bookings, attempts, offers,
-- payments, documents, registrations, tokens, tasks, events), so the delete is
-- one statement. Two things do not cascade and are handled here: the audit row
-- this writes, which must survive, and the contact, which is shared and only
-- goes when it has nothing left.
--
-- Storage objects are removed by the caller before this runs. They live
-- outside the database and a failure there must abort the whole thing, which
-- it cannot do from in here.
create or replace function public.delete_application(p_application_id uuid, p_reason text, p_actor_id uuid, p_actor_label text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app record;
  v_contact uuid;
  v_others int;
  v_docs int;
begin
  select a.*, c.first_name as contact_first, c.last_name as contact_last
    into v_app
    from public.applications a
    left join public.contacts c on c.id = a.contact_id
   where a.id = p_application_id;
  if not found then
    raise exception 'No application %.', p_application_id;
  end if;

  select count(*) into v_docs from public.documents where application_id = p_application_id;

  -- Written first and deliberately not cascaded: after the row is gone this
  -- is the only trace that it ever existed. It names the child, because an
  -- audit trail that cannot say what was destroyed is not one.
  insert into public.audit_log (actor_type, actor_id, actor_label, action, entity_type, entity_id, application_id, before, after)
  values (
    'staff', p_actor_id, p_actor_label, 'application.deleted', 'application', p_application_id, p_application_id,
    jsonb_build_object(
      'reference', v_app.reference,
      'child', trim(coalesce(v_app.child_first_name, '') || ' ' || coalesce(v_app.child_last_name, '')),
      'parent', trim(coalesce(v_app.contact_first, '') || ' ' || coalesce(v_app.contact_last, '')),
      'campus_id', v_app.campus_id,
      'grade_id', v_app.grade_id,
      'status', v_app.status,
      'documents', v_docs,
      'created_at', v_app.created_at
    ),
    jsonb_build_object('reason', p_reason)
  );

  v_contact := v_app.contact_id;

  perform set_config('app.deleting_application', 'on', true);
  delete from public.applications where id = p_application_id;
  perform set_config('app.deleting_application', 'off', true);

  -- The parent stays if another child of theirs is still applying; a contact
  -- with nothing left is just a name and a phone number nobody can reach a
  -- record through.
  if v_contact is not null then
    select count(*) into v_others from public.applications where contact_id = v_contact;
    if v_others = 0 then
      delete from public.contacts where id = v_contact;
    end if;
  end if;

  return jsonb_build_object(
    'reference', v_app.reference,
    'documents', v_docs,
    'contact_deleted', v_contact is not null and v_others = 0
  );
end;
$$;

revoke execute on function public.delete_application(uuid, text, uuid, text) from public, anon, authenticated;

comment on function public.delete_application(uuid, text, uuid, text) is
  'Removes an application and everything that cascades from it, leaving one audit row behind. Service role only; the console gates it on applications.delete. For a family exercising a right to erasure use anonymise_application instead, which keeps the analytics.';
