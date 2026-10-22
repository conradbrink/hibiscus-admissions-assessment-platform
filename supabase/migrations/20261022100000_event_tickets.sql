-- Selling tickets to an event, and stalls at it.
--
-- The school's Christmas Show is open to the public: parents, families who
-- are not at the school yet, and anybody else who hears about it. People buy
-- tickets online, pay through the school's gateway, and get one ticket per
-- person, each with its own number and the holder's name on it, to bring to
-- the gate. Traders book a stall the same way; a stall comes with tickets
-- for the stallholder and their staff.
--
-- An event is already a thing here (`crm_events`, 19 September): a name, a
-- campus, a date and a place. Selling tickets to one adds three things beside
-- it rather than a second idea of what an event is:
--
--   event_sales    what is on sale for one event: the prices, the early-bird
--                  date, whether sales are open, and the ticket counter.
--   event_orders   one checkout: who bought, how many, for how much, and the
--                  names to print. A stall booking is an order too.
--   event_tickets  issued only once an order is paid, one row per person.
--
-- Paying for an order goes through the payment records every other payment
-- uses (`20260912080000_student_payments.sql` explains why there is one set):
-- a third subject, the order, beside the admissions triple and the child.
-- The reconciler stays the only way to "paid".
--
-- Buyers are not families and hold no session. Every public read and write is
-- the service role's, after the page has checked what it may; staff read the
-- orders at the event's campus.

-- ---------------------------------------------------------------------------
-- What is on sale
-- ---------------------------------------------------------------------------

create table if not exists public.event_sales (
  event_id uuid primary key references public.crm_events(id) on delete cascade,
  -- The public address: /events/<slug>.
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 60),
  -- What one ticket is called on the page, the ticket and the email.
  ticket_label text not null default 'Ticket' check (length(ticket_label) between 1 and 40),
  ticket_price_minor bigint not null check (ticket_price_minor > 0),
  -- An early price, until a moment. Both or neither.
  early_price_minor bigint check (early_price_minor is null or early_price_minor > 0),
  early_until timestamptz,
  max_tickets_per_order int not null default 10 check (max_tickets_per_order between 1 and 30),
  tickets_open boolean not null default false,
  -- A stall: one price, and the tickets that come with it.
  stall_price_minor bigint check (stall_price_minor is null or stall_price_minor > 0),
  stall_tickets int not null default 2 check (stall_tickets between 1 and 10),
  stall_capacity int check (stall_capacity is null or stall_capacity > 0),
  stalls_open boolean not null default false,
  -- Printed in front of every ticket number: HCS-0042-K7Q.
  ticket_prefix text not null default 'TKT' check (ticket_prefix ~ '^[A-Z]{2,6}$'),
  -- The next ticket's sequence number. Only issue_event_tickets() moves it.
  next_ticket_no int not null default 1 check (next_ticket_no >= 1),
  -- Whether the start time on the event is the real one. An event row needs
  -- a time; a show whose time is not announced yet should not print one.
  show_time boolean not null default true,
  -- What the public pages say, in the school's words.
  intro text check (intro is null or length(intro) <= 4000),
  stall_intro text check (stall_intro is null or length(stall_intro) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((early_price_minor is null) = (early_until is null)),
  check (not stalls_open or stall_price_minor is not null)
);

drop trigger if exists event_sales_set_updated_at on public.event_sales;
create trigger event_sales_set_updated_at
  before update on public.event_sales
  for each row execute function public.set_updated_at();

-- A ticketed event belongs to a campus: the campus decides the currency the
-- money is taken in, and who on the staff may see it. A group-wide event has
-- neither answer. The counter starts at one whatever an insert said, so a
-- forged value cannot make two tickets share a number.
create or replace function public.event_sales_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.crm_events e where e.id = new.event_id and e.campus_id is not null) then
    raise exception 'a ticketed event must belong to a campus';
  end if;
  if tg_op = 'INSERT' then
    new.next_ticket_no := 1;
  end if;
  return new;
end;
$$;

revoke all on function public.event_sales_before_write() from public, anon, authenticated;

drop trigger if exists event_sales_before_write on public.event_sales;
create trigger event_sales_before_write
  before insert or update on public.event_sales
  for each row execute function public.event_sales_before_write();

comment on table public.event_sales is
  'What is on sale for one event: ticket and stall prices, the early-bird date, whether sales are open, and the ticket counter. One row per ticketed crm_events row.';

-- ---------------------------------------------------------------------------
-- One checkout
-- ---------------------------------------------------------------------------

create table if not exists public.event_orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.crm_events(id) on delete restrict,
  -- The event's campus when the order was taken: where the money went, and
  -- who may read it. Copied once, because the money does not move if the
  -- event later does.
  campus_id uuid not null references public.campuses(id) on delete restrict,
  kind text not null check (kind in ('tickets', 'stall')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  -- What the buyer quotes and what the bursar sees: HCS-7F3A9C.
  reference text not null unique,
  buyer_first_name text not null check (length(buyer_first_name) between 1 and 80),
  buyer_last_name text not null check (length(buyer_last_name) between 1 and 80),
  email text not null check (length(email) between 3 and 254),
  -- E.164, as lib/phone.ts stores every number.
  mobile text check (mobile is null or mobile ~ '^\+[1-9][0-9]{6,14}$'),
  -- Tickets bought, or 1 for a stall.
  quantity int not null check (quantity between 1 and 30),
  -- People the order lets in: the tickets it will issue. Kept apart from
  -- `holders` so the count survives anonymisation.
  ticket_count int not null check (ticket_count between 1 and 30),
  unit_amount_minor bigint not null check (unit_amount_minor > 0),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency in ('BWP', 'ZAR')),
  -- Which price applied: "Early bird", "Standard", "Stall".
  price_name text not null,
  -- [{first_name, last_name}], one per ticket, in the order they were typed.
  holders jsonb not null default '[]'::jsonb check (jsonb_typeof(holders) = 'array'),
  business_name text check (business_name is null or length(business_name) <= 120),
  stall_goods text check (stall_goods is null or length(stall_goods) <= 500),
  needs_power boolean,
  paid_at timestamptz,
  cancelled_at timestamptz,
  anonymised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (amount_minor = unit_amount_minor * quantity),
  check (kind = 'tickets' or (quantity = 1 and business_name is not null))
);

create index if not exists event_orders_event_idx on public.event_orders(event_id, status);
create index if not exists event_orders_campus_idx on public.event_orders(campus_id);

drop trigger if exists event_orders_set_updated_at on public.event_orders;
create trigger event_orders_set_updated_at
  before update on public.event_orders
  for each row execute function public.set_updated_at();

comment on table public.event_orders is
  'One checkout for an event: tickets, or a stall with its tickets. Written by the service role only, through create_event_order(); paid only by the payment reconciler.';

-- The links that show an order's tickets. One is made when the checkout
-- starts (the buyer's browser keeps it, so the gateway's return can find the
-- order), and a new one each time the tickets are emailed, minted at send
-- time so the raw value lives in the email and nowhere else. Only the SHA-256
-- is kept, as for every other link here.
--
-- No policies at all: the buyer is not a database principal, and nothing on
-- the staff side needs a link — staff read the order itself.
create table if not exists public.event_order_links (
  token_hash text primary key,
  order_id uuid not null references public.event_orders(id) on delete cascade,
  created_reason text not null check (created_reason in ('checkout', 'email')),
  created_at timestamptz not null default now()
);

create index if not exists event_order_links_order_idx on public.event_order_links(order_id);

alter table public.event_order_links enable row level security;
revoke all on public.event_order_links from anon, authenticated;

-- ---------------------------------------------------------------------------
-- What lets a person in
-- ---------------------------------------------------------------------------

create table if not exists public.event_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.event_orders(id) on delete restrict,
  event_id uuid not null references public.crm_events(id) on delete restrict,
  campus_id uuid not null references public.campuses(id) on delete restrict,
  number text not null unique,
  -- "Ticket", "Stallholder", "Stall staff".
  label text not null,
  holder_first_name text not null,
  holder_last_name text not null,
  issued_at timestamptz not null default now(),
  checked_in_at timestamptz,
  checked_in_by uuid references public.staff_profiles(id) on delete set null
);

create index if not exists event_tickets_order_idx on public.event_tickets(order_id);
create index if not exists event_tickets_event_idx on public.event_tickets(event_id);

-- Who let a person in is whoever is signed in, not what the browser said.
-- Undoing a check-in clears both.
create or replace function public.event_tickets_stamp_check_in()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.checked_in_at is null then
    new.checked_in_by := null;
  elsif old.checked_in_at is null then
    new.checked_in_by := (select auth.uid());
  else
    -- Already in: the first scan stands.
    new.checked_in_at := old.checked_in_at;
    new.checked_in_by := old.checked_in_by;
  end if;
  return new;
end;
$$;

revoke all on function public.event_tickets_stamp_check_in() from public, anon, authenticated;

drop trigger if exists event_tickets_stamp_check_in on public.event_tickets;
create trigger event_tickets_stamp_check_in
  before update of checked_in_at on public.event_tickets
  for each row execute function public.event_tickets_stamp_check_in();

comment on table public.event_tickets is
  'One person''s ticket, issued by issue_event_tickets() once the order is paid. Staff check people in at the gate; nothing else about a ticket is theirs to change.';

-- ---------------------------------------------------------------------------
-- Paying for an order: a third subject
-- ---------------------------------------------------------------------------

alter table public.payment_requests
  add column if not exists event_order_id uuid references public.event_orders(id) on delete restrict;

alter table public.payment_requests drop constraint if exists payment_requests_kind_check;
alter table public.payment_requests add constraint payment_requests_kind_check
  check (kind in ('admission', 'extras', 'event'));

alter table public.payment_requests drop constraint if exists payment_requests_has_one_subject;
alter table public.payment_requests add constraint payment_requests_has_one_subject
  check (
    (application_id is not null and offer_id is not null and acceptance_id is not null and student_id is null and event_order_id is null)
    or (student_id is not null and application_id is null and offer_id is null and acceptance_id is null and event_order_id is null)
    or (event_order_id is not null and application_id is null and offer_id is null and acceptance_id is null and student_id is null)
  );

create or replace function public.payment_requests_set_subject()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.application_id is not null then
    new.kind := 'admission';
    select a.campus_id into new.campus_id from public.applications a where a.id = new.application_id;
  elsif new.student_id is not null then
    new.kind := 'extras';
    select s.current_campus_id into new.campus_id from public.students s where s.id = new.student_id;
  elsif new.event_order_id is not null then
    new.kind := 'event';
    select o.campus_id into new.campus_id from public.event_orders o where o.id = new.event_order_id;
  end if;
  -- A request nobody can scope is a request nobody should be able to read.
  if new.campus_id is null then
    raise exception 'a payment request must resolve to a campus';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_requests_subject on public.payment_requests;
create trigger payment_requests_subject
  before insert or update of application_id, student_id, event_order_id, campus_id, kind
  on public.payment_requests
  for each row execute function public.payment_requests_set_subject();

-- One open request per order, as there is one per application and per child.
create unique index if not exists payment_requests_one_open_event_order_idx
  on public.payment_requests(event_order_id)
  where event_order_id is not null and status in ('required', 'processing', 'failed', 'partially_paid');

comment on column public.payment_requests.event_order_id is
  'The event order this is owed for. Exactly one subject is named: the admissions triple, a student, or an event order.';
comment on column public.payment_requests.kind is
  'admission | extras | event. Derived from the subject by payment_requests_set_subject(); never set by a caller.';

alter table public.payments
  add column if not exists event_order_id uuid references public.event_orders(id) on delete restrict;

alter table public.payments drop constraint if exists payments_has_one_subject;
alter table public.payments add constraint payments_has_one_subject
  check (
    (application_id is not null and student_id is null and event_order_id is null)
    or (student_id is not null and application_id is null and event_order_id is null)
    or (event_order_id is not null and application_id is null and student_id is null)
  );

create or replace function public.payments_set_subject()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_request record;
begin
  select application_id, student_id, event_order_id, campus_id
    into v_request
    from public.payment_requests
   where id = new.payment_request_id;
  if not found then
    raise exception 'a payment must belong to a payment request';
  end if;
  new.application_id := v_request.application_id;
  new.student_id     := v_request.student_id;
  new.event_order_id := v_request.event_order_id;
  new.campus_id      := v_request.campus_id;
  return new;
end;
$$;

drop trigger if exists payments_subject on public.payments;
create trigger payments_subject
  before insert or update of payment_request_id, application_id, student_id, event_order_id, campus_id
  on public.payments
  for each row execute function public.payments_set_subject();

create index if not exists payments_event_order_idx
  on public.payments(event_order_id) where event_order_id is not null;

comment on column public.payments.event_order_id is
  'The event order this payment is for. Copied from its request by payments_set_subject().';

-- ---------------------------------------------------------------------------
-- Taking an order
-- ---------------------------------------------------------------------------

-- The price, the "is it open", the "is there room" and the write, in one
-- transaction with the sales row locked, so two buyers cannot both take the
-- last ticket and the early price ends on the second the school chose, not
-- when somebody's page was loaded. The amount is computed here and nowhere
-- else: the form never carries a figure.
--
-- A pending order holds its places for a day — as long as the gateway keeps a
-- checkout open — so a buyer on their bank's password screen is not sold out
-- from under. One that fails or expires is cancelled by the reconciler and
-- frees them sooner.
--
-- Service role only: the buyer holds no database session, and the action has
-- already checked the names, the address and the number.
create or replace function public.create_event_order(
  p_event_id uuid,
  p_kind text,
  p_buyer_first_name text,
  p_buyer_last_name text,
  p_email text,
  p_mobile text,
  p_quantity int,
  p_holders jsonb,
  p_business_name text,
  p_stall_goods text,
  p_needs_power boolean,
  p_link_hash text
)
returns table (order_id uuid, order_reference text, order_amount_minor bigint, order_currency text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sales public.event_sales%rowtype;
  v_event public.crm_events%rowtype;
  v_currency text;
  v_quantity int;
  v_tickets int;
  v_unit bigint;
  v_price_name text;
  v_taken int;
  v_stalls int;
  v_holder jsonb;
  v_reference text;
  v_id uuid;
begin
  select * into v_sales from public.event_sales where event_id = p_event_id for update;
  if not found then
    raise exception 'not_on_sale';
  end if;
  select * into v_event from public.crm_events where id = p_event_id;
  if v_event.is_cancelled then
    raise exception 'event_cancelled';
  end if;
  if coalesce(v_event.ends_at, v_event.starts_at + interval '1 day') < now() then
    raise exception 'event_over';
  end if;
  select c.currency into v_currency from public.campuses c where c.id = v_event.campus_id;
  if v_currency is null then
    raise exception 'not_on_sale';
  end if;

  if p_kind = 'tickets' then
    if not v_sales.tickets_open then
      raise exception 'tickets_closed';
    end if;
    v_quantity := p_quantity;
    if v_quantity is null or v_quantity < 1 or v_quantity > v_sales.max_tickets_per_order then
      raise exception 'bad_quantity';
    end if;
    v_tickets := v_quantity;
    if v_sales.early_until is not null and now() < v_sales.early_until then
      v_unit := v_sales.early_price_minor;
      v_price_name := 'Early bird';
    else
      v_unit := v_sales.ticket_price_minor;
      v_price_name := 'Standard';
    end if;
  elsif p_kind = 'stall' then
    if not v_sales.stalls_open or v_sales.stall_price_minor is null then
      raise exception 'stalls_closed';
    end if;
    if coalesce(trim(p_business_name), '') = '' then
      raise exception 'bad_holders';
    end if;
    v_quantity := 1;
    v_tickets := v_sales.stall_tickets;
    v_unit := v_sales.stall_price_minor;
    v_price_name := 'Stall';
    if v_sales.stall_capacity is not null then
      select count(*) into v_stalls
        from public.event_orders o
       where o.event_id = p_event_id
         and o.kind = 'stall'
         and (o.status = 'paid' or (o.status = 'pending' and o.created_at > now() - interval '24 hours'));
      if v_stalls >= v_sales.stall_capacity then
        raise exception 'stalls_full';
      end if;
    end if;
  else
    raise exception 'bad_kind';
  end if;

  -- One name per ticket, and nothing else in the list.
  if jsonb_typeof(p_holders) <> 'array' or jsonb_array_length(p_holders) <> v_tickets then
    raise exception 'bad_holders';
  end if;
  for v_holder in select value from jsonb_array_elements(p_holders) loop
    if jsonb_typeof(v_holder) <> 'object'
       or coalesce(length(trim(v_holder->>'first_name')), 0) not between 1 and 80
       or coalesce(length(trim(v_holder->>'last_name')), 0) not between 1 and 80 then
      raise exception 'bad_holders';
    end if;
  end loop;

  if v_event.capacity is not null then
    select coalesce(sum(o.ticket_count), 0) into v_taken
      from public.event_orders o
     where o.event_id = p_event_id
       and (o.status = 'paid' or (o.status = 'pending' and o.created_at > now() - interval '24 hours'));
    if v_taken + v_tickets > v_event.capacity then
      raise exception 'sold_out';
    end if;
  end if;

  -- Six hex characters after the prefix. Unique by index; a collision is
  -- tried again rather than shown to a buyer.
  for i in 1..5 loop
    v_reference := v_sales.ticket_prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    begin
      insert into public.event_orders (
        event_id, campus_id, kind, reference,
        buyer_first_name, buyer_last_name, email, mobile,
        quantity, ticket_count, unit_amount_minor, amount_minor, currency, price_name,
        holders, business_name, stall_goods, needs_power
      ) values (
        p_event_id, v_event.campus_id, p_kind, v_reference,
        trim(p_buyer_first_name), trim(p_buyer_last_name), lower(trim(p_email)), nullif(trim(coalesce(p_mobile, '')), ''),
        v_quantity, v_tickets, v_unit, v_unit * v_quantity, v_currency, v_price_name,
        (select jsonb_agg(jsonb_build_object('first_name', trim(h->>'first_name'), 'last_name', trim(h->>'last_name')) order by n)
           from jsonb_array_elements(p_holders) with ordinality as x(h, n)),
        case when p_kind = 'stall' then trim(p_business_name) end,
        case when p_kind = 'stall' then nullif(trim(coalesce(p_stall_goods, '')), '') end,
        case when p_kind = 'stall' then coalesce(p_needs_power, false) end
      )
      returning id into v_id;
      exit;
    exception when unique_violation then
      if i = 5 then
        raise;
      end if;
    end;
  end loop;

  insert into public.event_order_links (token_hash, order_id, created_reason)
  values (p_link_hash, v_id, 'checkout');

  return query
    select o.id, o.reference, o.amount_minor, o.currency from public.event_orders o where o.id = v_id;
end;
$$;

revoke execute on function public.create_event_order(uuid, text, text, text, text, text, int, jsonb, text, text, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Issuing the tickets
-- ---------------------------------------------------------------------------

-- Once, for a paid order: one ticket per name, numbered from the event's
-- counter under its lock, so numbers never repeat and never skip. A second
-- call (a verify arriving twice) issues nothing.
--
-- The number is the prefix, the sequence and three letters from the CSPRNG:
-- HCS-0042-K7Q. The sequence is what the gate reads out; the letters make a
-- number nobody was sold hard to guess. No 0, O, 1, I, L, S, 5, 2, Z or B:
-- the gate reads them off a phone in the dark.
create or replace function public.issue_event_tickets(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order public.event_orders%rowtype;
  v_sales public.event_sales%rowtype;
  v_alphabet constant text := 'ACDEFGHJKMNPQRTUVWXY34679';
  v_bytes bytea;
  v_code text;
  v_n int;
  v_issued int := 0;
  v_holder jsonb;
  v_index int;
begin
  select * into v_order from public.event_orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if v_order.status <> 'paid' then
    raise exception 'order_not_paid';
  end if;
  if exists (select 1 from public.event_tickets t where t.order_id = p_order_id) then
    return 0;
  end if;

  select * into v_sales from public.event_sales where event_id = v_order.event_id for update;
  if not found then
    raise exception 'not_on_sale';
  end if;
  v_n := v_sales.next_ticket_no;

  for v_holder, v_index in
    select h, n from jsonb_array_elements(v_order.holders) with ordinality as x(h, n) order by n
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := substr(v_alphabet, get_byte(v_bytes, 0) % 25 + 1, 1)
           || substr(v_alphabet, get_byte(v_bytes, 1) % 25 + 1, 1)
           || substr(v_alphabet, get_byte(v_bytes, 2) % 25 + 1, 1);
    insert into public.event_tickets (order_id, event_id, campus_id, number, label, holder_first_name, holder_last_name)
    values (
      v_order.id, v_order.event_id, v_order.campus_id,
      v_sales.ticket_prefix || '-' || lpad(v_n::text, 4, '0') || '-' || v_code,
      case
        when v_order.kind = 'tickets' then v_sales.ticket_label
        when v_index = 1 then 'Stallholder'
        else 'Stall staff'
      end,
      v_holder->>'first_name',
      v_holder->>'last_name'
    );
    v_n := v_n + 1;
    v_issued := v_issued + 1;
  end loop;

  update public.event_sales set next_ticket_no = v_n where event_id = v_order.event_id;
  return v_issued;
end;
$$;

revoke execute on function public.issue_event_tickets(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Removing the buyers once the event is long past
-- ---------------------------------------------------------------------------

-- The names, addresses and numbers go; the counts, the amounts and the ticket
-- numbers stay, so the figures still add up. Called by the retention run
-- (lib/workflow/automation/retention.ts), never by a request.
create or replace function public.anonymise_event_orders(p_event_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  update public.event_tickets
     set holder_first_name = 'Removed', holder_last_name = 'Removed'
   where order_id in (select id from public.event_orders where event_id = p_event_id and anonymised_at is null);

  update public.email_messages
     set to_email = 'removed', subject = 'Removed', body_html = '', body_text = '', error = null
   where event_order_id in (select id from public.event_orders where event_id = p_event_id and anonymised_at is null);

  -- A link to a page that no longer names anybody is a link to nothing.
  delete from public.event_order_links
   where order_id in (select id from public.event_orders where event_id = p_event_id and anonymised_at is null);

  update public.event_orders
     set buyer_first_name = 'Removed',
         buyer_last_name = 'Removed',
         email = 'removed+' || id::text || '@invalid',
         mobile = null,
         holders = '[]'::jsonb,
         business_name = case when kind = 'stall' then 'Removed' end,
         stall_goods = null,
         anonymised_at = now()
   where event_id = p_event_id and anonymised_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.anonymise_event_orders(uuid) from public, anon, authenticated;

insert into public.settings (key, value, description)
values ('event_retention_days', '90'::jsonb,
  'Remove ticket buyers'' names and contact details this many days after a ticketed event ends. Runs with data retention, so only while that is switched on.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The emails
-- ---------------------------------------------------------------------------

-- A buyer is nobody's family and has no application, so the log learns a
-- third subject. Without it an event email would fall into the hole the
-- staff digest uses (no application, no family), which any member of staff
-- with applications.read may read at every campus.
alter table public.email_messages
  add column if not exists event_order_id uuid references public.event_orders(id) on delete set null;

create index if not exists email_messages_event_order_idx
  on public.email_messages(event_order_id) where event_order_id is not null;

drop policy if exists email_messages_select on public.email_messages;
create policy email_messages_select on public.email_messages
  for select using (
    (
      (select public.has_permission('applications.read'))
      and (
        (application_id is null and family_id is null and event_order_id is null)
        or exists (
          select 1 from public.applications a
          where a.id = email_messages.application_id
            and (select public.can_access_campus(a.campus_id))
        )
      )
    )
    or exists (
      select 1 from public.students s
      where s.family_id = email_messages.family_id
        and (select public.has_permission('students.read'))
        and (select public.can_access_campus(s.current_campus_id))
    )
    or exists (
      select 1 from public.event_orders o
      where o.id = email_messages.event_order_id
        and (select public.has_permission('crm.read'))
        and (select public.can_access_campus(o.campus_id))
    )
  );

-- 'event': written to somebody who bought a ticket. They are not a contact
-- and gave no WhatsApp consent, so these templates have no companion, and
-- the coverage check (which asks that of parent and family templates) does
-- not apply.
alter table public.email_templates drop constraint if exists email_templates_audience_check;
alter table public.email_templates add constraint email_templates_audience_check
  check (audience in ('parent', 'staff', 'family', 'event'));

insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
select
  'event_tickets', 1,
  'Event: your tickets',
  'Sent once an event order is paid. Lists every ticket with its number and name, and links to the page that shows them.',
  'Your tickets for {{event_name}}',
  E'Dear {{buyer_first_name}},\n\nThank you. Your payment of {{amount_paid}} is received.\n{{#if stall_name}}\nYour stall for {{stall_name}} is booked.\n{{/if}}\nHere are your tickets for {{event_name}}:\n\n{{ticket_list}}\n\nWhen: {{event_when}}\nWhere: {{event_location}}\n\nPlease bring a copy of each ticket to the gate. You can print this email, or show the tickets on your phone:\n{{tickets_link}}\n\nEach ticket has its own number. Each number lets one person in, once.\n\nYour order reference is {{order_reference}}.\n\nHibiscus International Schools',
  '<p>Dear {{buyer_first_name}},</p><p>Thank you. Your payment of <strong>{{amount_paid}}</strong> is received.</p>{{#if stall_name}}<p>Your stall for <strong>{{stall_name}}</strong> is booked.</p>{{/if}}<p>Here are your tickets for <strong>{{event_name}}</strong>:</p><p style="white-space:pre-line;font-family:monospace;font-size:15px">{{ticket_list}}</p><p><strong>When:</strong> {{event_when}}<br><strong>Where:</strong> {{event_location}}</p><p>Please bring a copy of each ticket to the gate. You can print this email, or show the tickets on your phone.</p><p><a href="{{tickets_link}}" class="button">Show my tickets</a></p><p>Each ticket has its own number. Each number lets one person in, once.</p><p>Your order reference is {{order_reference}}.</p><p>Hibiscus International Schools</p>',
  array['buyer_first_name', 'event_name', 'event_when', 'event_location', 'ticket_list', 'ticket_count', 'tickets_link', 'order_reference', 'amount_paid', 'stall_name'],
  true,
  'event'
where not exists (select 1 from public.email_templates where key = 'event_tickets');

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.event_sales enable row level security;
alter table public.event_orders enable row level security;
alter table public.event_tickets enable row level security;

-- The sales row is read and changed through its event, whose own policy is
-- the campus check (`crm_events_select`).
drop policy if exists event_sales_select on public.event_sales;
create policy event_sales_select on public.event_sales
  for select using (
    (select public.has_permission('crm.read'))
    and exists (select 1 from public.crm_events e where e.id = event_sales.event_id)
  );

drop policy if exists event_sales_insert on public.event_sales;
create policy event_sales_insert on public.event_sales
  for insert with check (
    (select public.has_permission('crm.write'))
    and exists (select 1 from public.crm_events e where e.id = event_sales.event_id)
  );

drop policy if exists event_sales_update on public.event_sales;
create policy event_sales_update on public.event_sales
  for update using (
    (select public.has_permission('crm.write'))
    and exists (select 1 from public.crm_events e where e.id = event_sales.event_id)
  );

-- No delete policy: an event with orders against it keeps its prices.

-- The counter is the issuing function's alone. A policy sees a row, not a
-- diff, so it is a column grant that keeps it out of reach.
revoke update on public.event_sales from authenticated;
grant update (
  slug,
  ticket_label,
  ticket_price_minor,
  early_price_minor,
  early_until,
  max_tickets_per_order,
  tickets_open,
  stall_price_minor,
  stall_tickets,
  stall_capacity,
  stalls_open,
  ticket_prefix,
  show_time,
  intro,
  stall_intro
) on public.event_sales to authenticated;

-- Orders: read at the campus by whoever looks after events or the money. No
-- write policy at all: an order is created by create_event_order() and paid
-- by the reconciler, both as the service role. A refund is finance's, at the
-- gateway, and recorded on the payment.
drop policy if exists event_orders_select on public.event_orders;
create policy event_orders_select on public.event_orders
  for select using (
    ((select public.has_permission('crm.read')) or (select public.has_permission('finance.read')))
    and (select public.can_access_campus(campus_id))
  );

drop policy if exists event_tickets_select on public.event_tickets;
create policy event_tickets_select on public.event_tickets
  for select using (
    ((select public.has_permission('crm.read')) or (select public.has_permission('finance.read')))
    and (select public.can_access_campus(campus_id))
  );

-- Checking somebody in at the gate, and undoing a mistake. Only those two
-- columns: a name or a number on a ticket is what was paid for.
drop policy if exists event_tickets_update on public.event_tickets;
create policy event_tickets_update on public.event_tickets
  for update using (
    (select public.has_permission('crm.write'))
    and (select public.can_access_campus(campus_id))
  );

revoke insert, update, delete on public.event_tickets from authenticated;
grant update (checked_in_at) on public.event_tickets to authenticated;
revoke insert, update, delete on public.event_orders from authenticated;

-- ---------------------------------------------------------------------------
-- The Christmas Show
-- ---------------------------------------------------------------------------

-- Asked for on 22 October 2026: the Hibiscus Christmas Show at Block 7,
-- Gaborone, on Friday 4 December 2026, open to the public. P150 a ticket
-- until a week before (to the end of Friday 27 November), P200 after that,
-- online and at the gate. A stall is P750 and includes two tickets: the
-- stallholder and one member of their staff.
--
-- The start time has not been announced, so the event starts at midnight
-- and the page prints no time (`show_time`). Sales ship closed: somebody at
-- the school sets the time and opens them from the event's Tickets page.
insert into public.crm_events (name, kind, campus_id, starts_at, location, description, registration_open)
select
  'Hibiscus Christmas Show 2027', 'other', c.id,
  timestamptz '2026-12-04 00:00:00+02',
  'Hibiscus Block 7 Campus, Gaborone',
  'The Hibiscus Christmas Show. Families, friends and the public are welcome. Tickets are sold online.',
  false
from public.campuses c
where c.code = 'block7'
  and not exists (select 1 from public.event_sales where slug = 'christmas-show');

insert into public.event_sales (
  event_id, slug, ticket_label, ticket_price_minor, early_price_minor, early_until,
  max_tickets_per_order, tickets_open, stall_price_minor, stall_tickets, stalls_open,
  ticket_prefix, show_time, intro, stall_intro
)
select
  e.id, 'christmas-show', 'Ticket', 20000, 15000, timestamptz '2026-11-28 00:00:00+02',
  10, false, 75000, 2, false,
  'HCS', false,
  E'Families, friends and the public are all welcome.\n\nEvery person needs a ticket with their own name on it. Buy them here, and bring a copy of each ticket to the gate.',
  null
from public.crm_events e
where e.name = 'Hibiscus Christmas Show 2027'
  and not exists (select 1 from public.event_sales where slug = 'christmas-show')
order by e.created_at desc
limit 1;
