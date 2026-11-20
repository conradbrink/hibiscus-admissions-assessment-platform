-- A dated offer on an event's tickets: Black Friday at the Christmas Show.
--
-- The school sent its Black Friday poster on 20 November 2026: a ticket to
-- the Christmas Show is P150 instead of P180 from 23 November to 1 December
-- 2026, bought on the page the tickets are already sold on (the code on the
-- poster opens /events/christmas-show).
--
-- `event_sales` knew two prices: an early one until a moment, and the
-- standard one after it. This is a third kind: a named price that starts on
-- one day and stops on another, in the middle of the other two. Four columns,
-- all set or all empty, and one more branch where the price is decided.
--
-- The rule, which lib/events/pricing.ts repeats for the page: work out the
-- price as before (early until its moment, standard after), then, while the
-- offer runs, charge the offer's price if it is the lower one. An offer never
-- makes a ticket dearer, so one typed above the early price by mistake does
-- nothing until the early price has ended.

alter table public.event_sales
  add column if not exists offer_name text,
  add column if not exists offer_price_minor bigint,
  add column if not exists offer_from timestamptz,
  add column if not exists offer_until timestamptz;

-- All four or none: a name short enough to print beside the price, a price
-- above nothing, and a start before its end. Added only where it is missing,
-- so the file can run twice.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'event_sales_offer_check'
       and conrelid = 'public.event_sales'::regclass
  ) then
    alter table public.event_sales add constraint event_sales_offer_check check (
      (offer_name is null and offer_price_minor is null and offer_from is null and offer_until is null)
      or (
        offer_name is not null and offer_price_minor is not null and offer_from is not null and offer_until is not null
        and length(btrim(offer_name)) between 1 and 40
        and offer_price_minor > 0
        and offer_from < offer_until
      )
    );
  end if;
end;
$$;

comment on column public.event_sales.offer_name is
  'A dated offer''s name, as the page and the order print it: "Black Friday". The four offer columns are all set or all empty.';
comment on column public.event_sales.offer_price_minor is
  'What one ticket costs while the offer runs, if that is lower than the early or standard price at that moment.';
comment on column public.event_sales.offer_from is
  'The moment the offer starts: midnight at the start of its first day, school time.';
comment on column public.event_sales.offer_until is
  'The moment the offer stops: midnight at the end of its last day, school time.';

-- Staff set an offer on the same form as the other prices. Column grants add
-- up, so this joins the list in 20261022100000_event_tickets.sql and the
-- ticket counter stays out of reach.
grant update (offer_name, offer_price_minor, offer_from, offer_until) on public.event_sales to authenticated;

-- ---------------------------------------------------------------------------
-- Taking an order
-- ---------------------------------------------------------------------------

-- As 20261022100000_event_tickets.sql wrote it, with the offer added where
-- the ticket price is chosen. Nothing else is changed: the lock, the checks,
-- the reference and the link are word for word what production already runs.
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
    -- A dated offer, while it runs, and only if it is the lower price.
    if v_sales.offer_from is not null
       and now() >= v_sales.offer_from and now() < v_sales.offer_until
       and v_sales.offer_price_minor < v_unit then
      v_unit := v_sales.offer_price_minor;
      v_price_name := btrim(v_sales.offer_name);
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

-- Still the service role's alone. Replacing a function keeps who may call
-- it; this says so again for a database built from these files.
revoke execute on function public.create_event_order(uuid, text, text, text, text, text, int, jsonb, text, text, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The Christmas Show's Black Friday offer
-- ---------------------------------------------------------------------------

-- From the poster: P150 a ticket, valid 23 November to 1 December 2026. It
-- starts at midnight at the start of Monday 23 November and stops at midnight
-- at the end of Tuesday 1 December, school time. The early and standard
-- prices are left as the school has set them.
update public.event_sales
   set offer_name = 'Black Friday',
       offer_price_minor = 15000,
       offer_from = timestamptz '2026-11-23 00:00:00+02',
       offer_until = timestamptz '2026-12-02 00:00:00+02'
 where slug = 'christmas-show'
   and offer_name is null;
