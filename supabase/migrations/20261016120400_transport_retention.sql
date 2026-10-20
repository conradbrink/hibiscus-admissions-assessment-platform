-- School transport, part five: removing the people and keeping the figures.
--
-- A booking holds a parent's name, email and mobile, the children's names and
-- where they live. That belongs in the retention story before the first
-- booking is taken, not after (web/AGENTS.md, "Retention deletes through one
-- function per subject").
--
-- `anonymise_application()` cannot reach a booking: the form is anonymous and
-- a booking names no application, contact or family. So transport has its
-- own function, beside it and in its image, and `lib/workflow/automation/
-- retention.ts` is to be the only thing that calls either; the sweep that
-- calls this one arrives with the booking pages, behind `retention_enabled`.
-- The rule in AGENTS.md is amended to say there are two.
--
-- What goes: every name, the email and mobile, the second contact, the
-- address, the landmark, every note and reason, the browser's details, the
-- payment lines' labels, the gateway's copy of the payer's name, the emails
-- sent about the booking and the details of its tasks.
--
-- What stays: the period, area, zone, school, grade, service, weekdays, the
-- tariff snapshot and every amount, the statuses and the dates — enough for
-- the financial report and the payouts to add up in five years' time.

create or replace function public.anonymise_transport_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_booking record;
  v_today date := (now() at time zone 'Africa/Gaborone')::date;
begin
  select b.id, b.status, b.anonymised_at, p.ends_on
    into v_booking
    from public.transport_bookings b
    join public.transport_periods p on p.id = b.period_id
   where b.id = p_booking_id
   for update of b;
  if not found then
    raise exception 'transport_booking_not_found';
  end if;
  if v_booking.anonymised_at is not null then
    return;
  end if;
  -- A child still being driven to school is not a record to clear. The
  -- sweep's own window decides when; this refuses the obvious mistake.
  if v_booking.status = 'paid' and v_booking.ends_on >= v_today then
    raise exception 'transport_booking_active';
  end if;
  -- Nor while the parent may be on the gateway's page paying for it.
  if exists (
    select 1 from public.payments where transport_booking_id = p_booking_id and status in ('pending', 'processing')
  ) then
    raise exception 'transport_payment_in_progress';
  end if;

  perform set_config('app.anonymising_transport', 'on', true);

  update public.transport_booking_riders
     set first_name = 'Removed',
         last_name = 'Removed',
         notes = null,
         cancel_reason = null,
         refund_note = null
   where booking_id = p_booking_id;

  update public.transport_bookings
     set parent_first_name = 'Removed',
         parent_last_name = 'Removed',
         email = 'removed+' || p_booking_id::text || '@invalid',
         email_normalised = 'removed+' || p_booking_id::text || '@invalid',
         mobile = null,
         second_contact_name = null,
         second_contact_mobile = null,
         address_line = 'Removed',
         landmark = null,
         notes = null,
         cancel_reason = null,
         ip_hash = null,
         user_agent = null,
         anonymised_at = now()
   where id = p_booking_id;

  perform set_config('app.anonymising_transport', 'off', true);

  -- A line's label names the child it was for. The code and amount stay.
  update public.payment_requests
     set lines = coalesce((
           select jsonb_agg(
                    case when jsonb_typeof(l) = 'object' and l ? 'label'
                         then jsonb_set(l, '{label}', to_jsonb('Removed'::text))
                         else l end
                    order by ord)
             from jsonb_array_elements(payment_requests.lines) with ordinality as x(l, ord)
         ), '[]'::jsonb)
   where transport_booking_id = p_booking_id;

  -- The gateway's answer stays, for finance; the payer's name in it does not.
  -- DPO returns `CustomerName`; PayGate's kept fields name nobody.
  update public.payments
     set raw_response = raw_response - 'CustomerName',
         note = null,
         refund_note = null
   where transport_booking_id = p_booking_id;

  update public.email_messages
     set to_email = 'removed', subject = 'Removed', body_html = '', body_text = '', error = null
   where transport_booking_id = p_booking_id;

  update public.tasks
     set details = null
   where transport_booking_id = p_booking_id;
end;
$$;

revoke all on function public.anonymise_transport_booking(uuid) from public, anon, authenticated;

comment on function public.anonymise_transport_booking(uuid) is
  'Removes the people from a transport booking and keeps the figures. Service role only; lib/workflow/automation/retention.ts is to be its only caller.';
