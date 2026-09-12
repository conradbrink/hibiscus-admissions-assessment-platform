-- Orientation: what each member of staff has read, and whether they finished.
--
-- The orientation is eleven screens that walk a new colleague through the
-- system in the order a family moves through it. It has to know two things
-- about the person reading it: which screens they have already read, and
-- whether they are done — because "done" is what makes it stop appearing.
--
-- Both live on the staff profile rather than in a table of their own. It is
-- one row per person either way, it is read on every console page load (the
-- profile is already fetched there), and a join for a fact this small would
-- be a join on every request.

alter table public.staff_profiles
  add column if not exists orientation_read text[] not null default '{}',
  add column if not exists orientation_completed_at timestamptz;

comment on column public.staff_profiles.orientation_read is
  'Slugs of the orientation screens this person has marked as read.';
comment on column public.staff_profiles.orientation_completed_at is
  'Set when the last screen is marked read. Until it is set, the console keeps offering the orientation.';

-- ---------------------------------------------------------------------------
-- Marking a screen read
-- ---------------------------------------------------------------------------

-- A function rather than a policy, deliberately.
--
-- Letting a person update their own staff_profiles row would be the smaller
-- change to write and the larger one to live with: the same policy that lets
-- somebody tick off a page of orientation would let them set is_active, and
-- RLS grants a row, not a column. So the only self-service write on this
-- table stays a definer function that can touch exactly these two columns.
--
-- Idempotent: marking a screen read twice is what a person pressing the
-- button twice does, and it must not undo the completion.
create or replace function public.mark_orientation_read(p_slug text, p_complete boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'not_signed_in';
  end if;
  if p_slug is null or length(trim(p_slug)) = 0 or length(p_slug) > 64 then
    raise exception 'bad_slug';
  end if;

  update public.staff_profiles
     set orientation_read = (
           case when p_slug = any(orientation_read) then orientation_read
                else orientation_read || p_slug end
         ),
         orientation_completed_at = case
           when p_complete then coalesce(orientation_completed_at, now())
           else orientation_completed_at
         end,
         updated_at = now()
   where id = v_id;
end;
$$;

revoke all on function public.mark_orientation_read(text, boolean) from public;
grant execute on function public.mark_orientation_read(text, boolean) to authenticated;

-- Reading it again after finishing is allowed — the screens stay at
-- /staff/orientation — so there is a way back to the unfinished state for
-- somebody who wants the prompts again.
create or replace function public.reset_orientation()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'not_signed_in';
  end if;
  update public.staff_profiles
     set orientation_read = '{}', orientation_completed_at = null, updated_at = now()
   where id = v_id;
end;
$$;

revoke all on function public.reset_orientation() from public;
grant execute on function public.reset_orientation() to authenticated;

-- ---------------------------------------------------------------------------
-- The columns nobody may set on themselves
-- ---------------------------------------------------------------------------

-- Writing the orientation checks above turned up an older hole. The policy
-- `staff_profiles_update` has always read:
--
--   id = auth.uid() or has_permission('staff.write')
--
-- so a person may update their own row — which was meant for their name and
-- their digest preference, and in fact covers every column, `is_active`
-- included. A member of staff who has been deactivated still holds a valid
-- session cookie until it expires, and could have switched themselves back
-- on with a single request. RLS grants a row and not a column, so the policy
-- cannot express the distinction; a trigger can.
--
-- Anyone holding staff.write is untouched: deactivating a colleague from
-- Settings → Staff and roles goes through this same table. So is the service
-- role, which has no auth.uid() and does the invite and deletion work.
create or replace function public.staff_profiles_guard_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Service role, the job runner, migrations: no signed-in person.
  if auth.uid() is null then
    return new;
  end if;
  -- The people whose job this is.
  if public.has_permission('staff.write') then
    return new;
  end if;
  -- Everybody else: their own name and their own preferences, nothing that
  -- decides whether they may sign in or who they are.
  new.id := old.id;
  new.email := old.email;
  new.is_active := old.is_active;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists staff_profiles_guard_self_update on public.staff_profiles;
create trigger staff_profiles_guard_self_update
  before update on public.staff_profiles
  for each row execute function public.staff_profiles_guard_self_update();
