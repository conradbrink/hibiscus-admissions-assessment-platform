-- The optional extras a family can order: stationery, transport, lunch,
-- aftercare and whatever the school adds next.
--
-- This is the catalogue and the choosing. Paying for it comes next and
-- deliberately separately, because that one touches `payment_requests` and
-- `payments`, which are welded to the admissions funnel and carry real money.
--
-- ---------------------------------------------------------------------------
-- Why this is not the existing `choice` onboarding steps
-- ---------------------------------------------------------------------------
--
-- `uniform`, `book_pack` and `transport` are already `kind = 'choice'` steps
-- with an `options` array, and it is tempting to put a price in there. It is
-- the wrong home: `options` is a jsonb list of strings on a table designed for
-- checkboxes, with no currency, no quantity, no order-by date and nothing to
-- hang a payment off. Money in that shape is money nobody can reconcile.
--
-- So the checklist keeps asking the questions it is good at — what size, which
-- route — and the catalogue owns what is bought.

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------

-- `campus_id` is NOT NULL, unlike the grade bands on `document_requirements`
-- and `fee_schedules`. A single row priced for every campus cannot be right:
-- Potchefstroom charges in rand and the Botswana campuses in pula, and one
-- `amount_minor` cannot be both. Each campus prices its own extras, and the
-- currency follows the campus rather than being typed in a second time.
create table if not exists public.optional_items (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9_]+$'),
  label text not null,
  description text,
  category text not null default 'other'
    check (category in ('stationery', 'transport', 'lunch', 'aftercare', 'uniform', 'other')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('BWP', 'ZAR')),
  -- Null on both: every grade at the campus. The same band convention as
  -- `document_requirements` and `fee_schedules`; a narrower band wins.
  grade_sort_min int,
  grade_sort_max int,
  -- What a parent must pick when they order: a transport route, a lunch plan.
  -- Empty: there is nothing to choose, they simply want one.
  options jsonb not null default '[]'::jsonb,
  -- More than one of a thing — a second set of readers, a sibling's lunch.
  allow_quantity boolean not null default false,
  -- The date the school has to place its own order by. Shown to the parent as
  -- a deadline and used to decide what is worth mentioning in a reminder.
  order_by date,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campus_id, code),
  check (grade_sort_min is null or grade_sort_max is null or grade_sort_max >= grade_sort_min)
);

drop trigger if exists optional_items_set_updated_at on public.optional_items;
create trigger optional_items_set_updated_at
  before update on public.optional_items
  for each row execute function public.set_updated_at();

-- The currency is its campus's, set here so a form cannot get it wrong. The
-- same guard `fee_schedules` uses, for the same reason.
create or replace function public.optional_items_set_currency()
returns trigger language plpgsql as $$
begin
  select c.currency into new.currency from public.campuses c where c.id = new.campus_id;
  return new;
end;
$$;

drop trigger if exists optional_items_currency on public.optional_items;
create trigger optional_items_currency
  before insert or update of campus_id on public.optional_items
  for each row execute function public.optional_items_set_currency();

comment on table public.optional_items is
  'What a family may buy alongside a place: stationery, transport, lunch, aftercare. Priced per campus, because the currency is the campus''s.';

-- ---------------------------------------------------------------------------
-- What a family chose
-- ---------------------------------------------------------------------------

create table if not exists public.student_optional_selections (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  item_id uuid not null references public.optional_items(id) on delete restrict,
  -- Denormalised for the read policy, like `tasks.campus_id` and
  -- `student_onboarding_items.campus_id`.
  campus_id uuid not null references public.campuses(id) on delete restrict,
  quantity int not null default 1 check (quantity > 0),
  -- Which option they picked, when the item offers any.
  choice text,
  -- Priced when they chose, not when somebody reads it back. The catalogue
  -- will change between a family ordering in November and the office
  -- reconciling in January, and a family pays what they were shown. The same
  -- reason the accepted offer snapshots its fees.
  unit_amount_minor bigint not null check (unit_amount_minor > 0),
  currency text not null check (currency in ('BWP', 'ZAR')),
  status text not null default 'selected' check (status in ('selected', 'paid', 'cancelled')),
  selected_at timestamptz not null default now(),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One line per item per child. Wanting two is `quantity`, not a second row.
  unique (student_id, item_id)
);

drop trigger if exists student_optional_selections_set_updated_at on public.student_optional_selections;
create trigger student_optional_selections_set_updated_at
  before update on public.student_optional_selections
  for each row execute function public.set_updated_at();

create index if not exists optional_selections_student_idx
  on public.student_optional_selections(student_id);
create index if not exists optional_selections_campus_idx
  on public.student_optional_selections(campus_id, status);

comment on table public.student_optional_selections is
  'One line per extra a family has chosen for a child, priced at the moment they chose it.';

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.optional_items enable row level security;
alter table public.student_optional_selections enable row level security;

-- The catalogue is not secret: any signed-in member of staff can read it, the
-- same as the message templates and the document requirements.
drop policy if exists optional_items_select on public.optional_items;
create policy optional_items_select on public.optional_items
  for select using ((select public.current_staff_id()) is not null);

drop policy if exists optional_items_write on public.optional_items;
create policy optional_items_write on public.optional_items
  for all using ((select public.has_permission('settings.write')))
  with check ((select public.has_permission('settings.write')));

-- What a family ordered follows the campus, like everything else about their
-- child. Parents are not database principals: their side goes through the
-- service role and `lib/family/`, which is where the family is checked.
drop policy if exists optional_selections_select on public.student_optional_selections;
create policy optional_selections_select on public.student_optional_selections
  for select using (
    (select public.has_permission('applications.read'))
    and (select public.can_access_campus(campus_id))
  );

-- The office can cancel a line a family asked to drop. It cannot create one:
-- a family orders for themselves, and an order nobody placed is an invoice
-- nobody agreed to.
drop policy if exists optional_selections_update on public.student_optional_selections;
create policy optional_selections_update on public.student_optional_selections
  for update using (
    (select public.has_permission('applications.write'))
    and (select public.can_access_campus(campus_id))
  );
