-- Managing people, and changing what a role may do, become separate powers.
--
-- `staff.write` used to mean all of: invite a colleague, set their roles and
-- campuses, deactivate them, delete them outright, and rewrite the whole
-- role/permission matrix. An admissions manager needs the first of those and
-- must not have the last two: someone who can edit the matrix can give their
-- own role every permission in the system, which makes every other check in
-- the database decorative.
--
-- After this migration:
--
--   staff.write   invite a colleague, set their roles and campuses, turn
--                 their sign-in on and off
--   roles.write   change what each role may do (the matrix)
--   staff.delete  remove a person's account entirely
--
-- and three rules hold in the database, not merely in the console:
--
--   1. Nobody edits their own roles or campuses unless they hold
--      `roles.write`. Self-promotion is the shortest way round everything.
--   2. Nobody grants (or takes away) a role carrying a permission they do not
--      hold themselves. Otherwise an admissions manager invites a second
--      account, makes it a super administrator, and signs in as it.
--   3. Only `roles.write` may touch the matrix, and only `staff.delete` may
--      delete a person.

-- ---------------------------------------------------------------------------
-- The two new permissions
-- ---------------------------------------------------------------------------

insert into public.permissions (code, label, sort_order) values
  ('roles.write',  'Change what each role may do',  132),
  ('staff.delete', 'Delete a staff account',        134)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

-- `staff.write` no longer covers the matrix or deletion, so its wording in
-- the catalogue changes with it.
update public.permissions
   set label = 'Invite colleagues and set their roles and campuses'
 where code = 'staff.write';

-- Both go to the super administrator alone. That role holds `admin`, which
-- already satisfies every check, so this is belt and braces for readability
-- in the matrix rather than a change in what it can do.
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code
from public.roles r
cross join (values ('roles.write'), ('staff.delete')) as p(code)
where r.code = 'super_admin'
on conflict do nothing;

-- The admissions manager gains the narrowed `staff.write`: inviting a
-- colleague and setting their roles is part of running admissions. Neither
-- new permission comes with it, so the matrix and deletion stay above them.
insert into public.role_permissions (role_id, permission_code)
select r.id, 'staff.write'
from public.roles r
where r.code = 'admissions_manager'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- May the signed-in person hand out this role?
-- ---------------------------------------------------------------------------

-- True when every permission the role carries is one the caller already holds.
-- A role with no permissions is grantable by anyone with `staff.write`.
create or replace function public.can_grant_role(p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission('admin') or not exists (
    select 1
    from public.role_permissions rp
    where rp.role_id = p_role_id
      and not public.has_permission(rp.permission_code)
  )
$$;

revoke execute on function public.can_grant_role(uuid) from public, anon;
grant execute on function public.can_grant_role(uuid) to authenticated;

comment on function public.can_grant_role(uuid) is
  'True when the caller holds every permission the role carries. Stops a person handing out more than they have.';

-- ---------------------------------------------------------------------------
-- The matrix: roles.write only
-- ---------------------------------------------------------------------------

drop policy if exists role_permissions_insert on public.role_permissions;
create policy role_permissions_insert on public.role_permissions
  for insert with check ((select public.has_permission('roles.write')));

drop policy if exists role_permissions_delete on public.role_permissions;
create policy role_permissions_delete on public.role_permissions
  for delete using ((select public.has_permission('roles.write')));

drop policy if exists roles_insert on public.roles;
create policy roles_insert on public.roles
  for insert with check ((select public.has_permission('roles.write')));

drop policy if exists roles_update on public.roles;
create policy roles_update on public.roles
  for update using ((select public.has_permission('roles.write')));

drop policy if exists roles_delete on public.roles;
create policy roles_delete on public.roles
  for delete using ((select public.has_permission('roles.write')) and not is_system);

-- ---------------------------------------------------------------------------
-- Who holds which role: staff.write, but never your own, and never above
-- your own ceiling
-- ---------------------------------------------------------------------------

drop policy if exists staff_roles_insert on public.staff_roles;
create policy staff_roles_insert on public.staff_roles
  for insert with check (
    (select public.has_permission('staff.write'))
    and (staff_id <> (select auth.uid()) or (select public.has_permission('roles.write')))
    and (select public.can_grant_role(role_id))
  );

drop policy if exists staff_roles_delete on public.staff_roles;
create policy staff_roles_delete on public.staff_roles
  for delete using (
    (select public.has_permission('staff.write'))
    and (staff_id <> (select auth.uid()) or (select public.has_permission('roles.write')))
    -- Taking a role away is symmetric: an admissions manager may not demote
    -- the super administrator either.
    and (select public.can_grant_role(role_id))
  );

drop policy if exists staff_campuses_insert on public.staff_campuses;
create policy staff_campuses_insert on public.staff_campuses
  for insert with check (
    (select public.has_permission('staff.write'))
    and (staff_id <> (select auth.uid()) or (select public.has_permission('roles.write')))
  );

drop policy if exists staff_campuses_delete on public.staff_campuses;
create policy staff_campuses_delete on public.staff_campuses
  for delete using (
    (select public.has_permission('staff.write'))
    and (staff_id <> (select auth.uid()) or (select public.has_permission('roles.write')))
  );
