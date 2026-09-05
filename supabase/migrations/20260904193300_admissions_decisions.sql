-- How an assessed application becomes a decision, and the learning profile
-- that goes with it.
--
-- The rules engine is deterministic: it reads the scores and a ruleset and
-- returns an outcome. No model is involved anywhere in this path, and there
-- is no ruleset seeded here — the school's education staff write the
-- thresholds. Until an active ruleset exists, every assessed applicant
-- routes to staff review, which is the safe default and not a placeholder.
--
-- Rulesets are versioned and immutable once active, and every decision
-- records the ruleset version and a snapshot of the scores it read. A
-- decision made under last year's rules can be re-explained exactly after
-- the rules change, which is what makes it defensible.

-- ---------------------------------------------------------------------------
-- Rulesets
-- ---------------------------------------------------------------------------

create table if not exists public.admission_rulesets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  -- Null on both: every grade. Null campus: every campus. A campus-specific
  -- ruleset beats a global one for that campus.
  grade_sort_min int,
  grade_sort_max int,
  campus_id uuid references public.campuses(id) on delete cascade,
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'active', 'superseded')),
  activated_at timestamptz,
  activated_by uuid references public.staff_profiles(id) on delete set null,
  created_by uuid references public.staff_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (grade_sort_min is null or grade_sort_max is null or grade_sort_max >= grade_sort_min)
);

drop trigger if exists admission_rulesets_set_updated_at on public.admission_rulesets;
create trigger admission_rulesets_set_updated_at
  before update on public.admission_rulesets
  for each row execute function public.set_updated_at();

create index if not exists admission_rulesets_active_idx
  on public.admission_rulesets(campus_id, grade_sort_min, grade_sort_max)
  where status = 'active';

create table if not exists public.admission_rules (
  id uuid primary key default gen_random_uuid(),
  ruleset_id uuid not null references public.admission_rulesets(id) on delete cascade,
  scope text not null check (scope in ('overall', 'subject', 'competency')),
  -- Polymorphic, like benchmarks.scope_id. Null for overall.
  scope_id uuid,
  operator text not null check (operator in ('>=', '>', '<=', '<')),
  threshold numeric(5,2) not null check (threshold between 0 and 100),
  -- hard_fail: violated → declined. review: violated → a person decides.
  severity text not null check (severity in ('hard_fail', 'review')),
  label text not null,
  position int not null default 0,
  check ((scope = 'overall') = (scope_id is null))
);

create index if not exists admission_rules_ruleset_idx on public.admission_rules(ruleset_id, position);

-- An active or superseded ruleset is frozen: its rules cannot change and
-- its band cannot move. Edit by creating a draft and activating that.
create or replace function public.admission_rulesets_freeze()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'draft' then
    if new.status = old.status
       or new.name is distinct from old.name
       or new.grade_sort_min is distinct from old.grade_sort_min
       or new.grade_sort_max is distinct from old.grade_sort_max
       or new.campus_id is distinct from old.campus_id then
      if not (old.status = 'active' and new.status = 'superseded'
              and new.name = old.name and new.grade_sort_min is not distinct from old.grade_sort_min
              and new.grade_sort_max is not distinct from old.grade_sort_max
              and new.campus_id is not distinct from old.campus_id) then
        raise exception 'An active ruleset cannot be edited. Create a new draft and activate it.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.admission_rulesets_freeze() from public, anon, authenticated;

drop trigger if exists admission_rulesets_freeze on public.admission_rulesets;
create trigger admission_rulesets_freeze
  before update on public.admission_rulesets
  for each row execute function public.admission_rulesets_freeze();

create or replace function public.admission_rules_freeze()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.admission_rulesets
   where id = coalesce(new.ruleset_id, old.ruleset_id);
  if v_status is distinct from 'draft' then
    raise exception 'The rules of an active ruleset cannot be changed. Create a new draft and activate it.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.admission_rules_freeze() from public, anon, authenticated;

drop trigger if exists admission_rules_freeze on public.admission_rules;
create trigger admission_rules_freeze
  before insert or update or delete on public.admission_rules
  for each row execute function public.admission_rules_freeze();

-- Activation: the new ruleset goes live and the previous active one with
-- the same campus scope is superseded, in one transaction, so there is
-- never a moment with two rulesets claiming the same applicants.
create or replace function public.activate_ruleset(p_ruleset_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r public.admission_rulesets%rowtype;
begin
  if not public.has_permission('rules.write') then
    raise exception 'permission_denied';
  end if;
  select * into r from public.admission_rulesets where id = p_ruleset_id for update;
  if not found or r.status <> 'draft' then
    raise exception 'ruleset_not_draft';
  end if;
  if not exists (select 1 from public.admission_rules where ruleset_id = p_ruleset_id) then
    raise exception 'ruleset_empty';
  end if;
  update public.admission_rulesets
     set status = 'superseded'
   where status = 'active'
     and campus_id is not distinct from r.campus_id
     and grade_sort_min is not distinct from r.grade_sort_min
     and grade_sort_max is not distinct from r.grade_sort_max;
  update public.admission_rulesets
     set status = 'active', activated_at = now(), activated_by = auth.uid(),
         version = coalesce((select max(version) from public.admission_rulesets
                             where campus_id is not distinct from r.campus_id
                               and grade_sort_min is not distinct from r.grade_sort_min
                               and grade_sort_max is not distinct from r.grade_sort_max), 0) + 1
   where id = p_ruleset_id;
end;
$$;

revoke execute on function public.activate_ruleset(uuid) from public, anon;
grant execute on function public.activate_ruleset(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Decisions
-- ---------------------------------------------------------------------------

-- Append-only. A new decision (an override) is a new row; the computed
-- outcome it overrides is never rewritten.
create table if not exists public.admission_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  -- Null for a pre-school decision, which has no assessment.
  attempt_id uuid references public.attempts(id) on delete set null,
  ruleset_id uuid references public.admission_rulesets(id) on delete set null,
  ruleset_version int,
  -- The scores the rules read, and the rule results, exactly as evaluated.
  inputs jsonb not null default '{}'::jsonb,
  computed_outcome text not null check (computed_outcome in ('approved', 'waitlisted', 'declined', 'staff_review')),
  final_outcome text not null check (final_outcome in ('approved', 'waitlisted', 'declined', 'staff_review')),
  decided_by text not null check (decided_by in ('rules', 'staff')),
  staff_id uuid references public.staff_profiles(id) on delete set null,
  override_reason text,
  decided_at timestamptz not null default now()
);

create index if not exists admission_decisions_application_idx
  on public.admission_decisions(application_id, decided_at desc);

-- The only append-only mechanism that binds the service role as well as
-- staff: a trigger, not a policy.
create or replace function public.admission_decisions_immutable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Admission decisions are append-only. Record a new decision with a reason.';
end;
$$;

revoke all on function public.admission_decisions_immutable() from public, anon, authenticated;

drop trigger if exists admission_decisions_immutable on public.admission_decisions;
create trigger admission_decisions_immutable
  before update or delete on public.admission_decisions
  for each row execute function public.admission_decisions_immutable();

-- ---------------------------------------------------------------------------
-- Learning profiles
-- ---------------------------------------------------------------------------

-- `computed` is everything numeric and every list, produced by code from
-- the scores. `narrative` is prose, produced by the AI provider from
-- `computed` and validated against it, or by a deterministic template when
-- the AI is off, refuses, fails or fails validation. `narrative_source`
-- says which, and `validation_errors` says why, so every sentence a parent
-- reads is traceable.
create table if not exists public.learning_profiles (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.attempts(id) on delete cascade,
  application_id uuid not null references public.applications(id) on delete cascade,
  computed jsonb not null,
  narrative jsonb not null,
  narrative_source text not null check (narrative_source in ('ai', 'fallback')),
  ai_model text,
  prompt_version text,
  validation_status text not null default 'not_run' check (validation_status in ('passed', 'failed', 'not_run')),
  validation_errors jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists learning_profiles_set_updated_at on public.learning_profiles;
create trigger learning_profiles_set_updated_at
  before update on public.learning_profiles
  for each row execute function public.set_updated_at();

create index if not exists learning_profiles_application_idx on public.learning_profiles(application_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.admission_rulesets enable row level security;
alter table public.admission_rules enable row level security;
alter table public.admission_decisions enable row level security;
alter table public.learning_profiles enable row level security;

drop policy if exists admission_rulesets_select on public.admission_rulesets;
create policy admission_rulesets_select on public.admission_rulesets
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists admission_rulesets_insert on public.admission_rulesets;
create policy admission_rulesets_insert on public.admission_rulesets
  for insert with check (
    (select public.has_permission('rules.write'))
    and created_by = (select auth.uid())
  );
drop policy if exists admission_rulesets_update on public.admission_rulesets;
create policy admission_rulesets_update on public.admission_rulesets
  for update using ((select public.has_permission('rules.write')));
drop policy if exists admission_rulesets_delete on public.admission_rulesets;
create policy admission_rulesets_delete on public.admission_rulesets
  for delete using ((select public.has_permission('rules.write')) and status = 'draft');

drop policy if exists admission_rules_select on public.admission_rules;
create policy admission_rules_select on public.admission_rules
  for select using ((select public.current_staff_id()) is not null);
drop policy if exists admission_rules_write on public.admission_rules;
create policy admission_rules_write on public.admission_rules
  for all using ((select public.has_permission('rules.write')))
  with check ((select public.has_permission('rules.write')));

-- Decisions and profiles: readable by anyone who may read the applicant.
-- Written by the engine under the service role only — an override goes
-- through the engine so it is audited and the application moves with it.
drop policy if exists admission_decisions_select on public.admission_decisions;
create policy admission_decisions_select on public.admission_decisions
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = admission_decisions.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );

drop policy if exists learning_profiles_select on public.learning_profiles;
create policy learning_profiles_select on public.learning_profiles
  for select using (
    exists (
      select 1 from public.applications a
      where a.id = learning_profiles.application_id
        and (select public.has_permission('applications.read'))
        and (select public.can_access_campus(a.campus_id))
    )
  );
