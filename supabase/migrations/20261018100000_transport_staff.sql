-- School transport, part seven: the staff screens.
--
-- The bookings list, the rider list for the provider, the earnings report and
-- the payouts screen read what parts one to six already hold, and every
-- write goes through the functions those parts defined
-- (`transport_cancel_riders`, `transport_record_refund`,
-- `transport_record_payout`). The one new thing is the email a parent gets
-- when a member of staff cancels their child's transport.
--
-- Plain English (CEFR B1–B2): short sentences, the reference twice, the next
-- step said once. The reason a member of staff typed stays on the booking and
-- is not sent: it is written for colleagues. The booker is not a contact and
-- has not opted in to WhatsApp, so there is no companion
-- (supabase/tests/template_coverage.sql).

insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
values (
  'transport_cancelled', 1,
  'School transport: cancelled',
  'Sent when a member of staff cancels transport for one or more children on a booking, if they tick "Tell the parent by email".',
  'School transport cancelled: {{booking_reference}}',
  'Dear {{parent_first_name}},

We have cancelled school transport for: {{children}}.

Booking reference: {{booking_reference}}
Period: {{period}} ({{period_dates}})

If you paid for this transport, the school will contact you about a refund.

If you did not ask for this, or you have a question, please contact {{office_contact}}. Please quote your booking reference.

Warm regards,
Hibiscus International Schools',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>We have cancelled school transport for: {{children}}.</p>'
  || '<p>Booking reference: <strong>{{booking_reference}}</strong><br>Period: {{period}} ({{period_dates}})</p>'
  || '<p>If you paid for this transport, the school will contact you about a refund.</p>'
  || '<p>If you did not ask for this, or you have a question, please contact {{office_contact}}. Please quote your booking reference.</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools</p>',
  array['parent_first_name', 'booking_reference', 'period', 'period_dates', 'children', 'office_contact'],
  true, 'transport'
)
on conflict (key, version) do nothing;

do $$
begin
  if not exists (select 1 from public.email_templates where key = 'transport_cancelled' and is_active and audience = 'transport') then
    raise exception 'the transport_cancelled email is missing';
  end if;
end
$$;
