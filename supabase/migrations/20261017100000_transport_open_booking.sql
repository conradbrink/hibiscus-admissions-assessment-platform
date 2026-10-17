-- School transport, part six: what it takes to open booking.
--
-- The parent pages arrive with this file. Three things go with them:
--
--   * Who parents call about transport, shown on the pages and in the emails.
--   * The transport coordinator may switch booking on and off, and change
--     that contact and the unpaid window, without holding `settings.write`,
--     which reaches every switch in the system. Only those three keys; the
--     retention periods stay with whoever owns data protection.
--   * The email a parent gets when their payment is confirmed, with the
--     receipt attached by the sender.

insert into public.settings (key, value, description) values
  ('transport_office_contact', '""',
   'Who a parent calls about school transport, shown on the booking pages and in the emails, e.g. "the transport desk on 71 234 567".')
on conflict (key) do nothing;

-- A second, narrower update policy beside `settings_update`. Postgres ORs
-- permissive policies, so `settings.write` still reaches everything and
-- `transport.manage` reaches these three keys and nothing else. No insert or
-- delete, as before: the keys are defined by migrations.
drop policy if exists settings_update_transport on public.settings;
create policy settings_update_transport on public.settings
  for update
  using (
    (select public.has_permission('transport.manage'))
    and key in ('transport_booking_enabled', 'transport_office_contact', 'transport_unpaid_hours')
  )
  with check (
    (select public.has_permission('transport.manage'))
    and key in ('transport_booking_enabled', 'transport_office_contact', 'transport_unpaid_hours')
  );

-- Plain English (CEFR B1–B2): short sentences, the reference twice, the next
-- step said once. The booker is not a contact and has not opted in to
-- WhatsApp, so this has no companion (supabase/tests/template_coverage.sql).
insert into public.email_templates (key, version, name, description, subject, body_text, body_html, allowed_variables, is_active, audience)
values (
  'transport_paid', 1,
  'School transport: payment received',
  'Sent when a school transport booking is paid. The receipt is attached.',
  'School transport booked: {{booking_reference}}',
  'Dear {{parent_first_name}},

Thank you. We have received your payment of {{amount_paid}} for school transport.

Booking reference: {{booking_reference}}
Period: {{period}} ({{period_dates}})
Children: {{children}}

Your receipt is attached to this email. The transport provider will contact you before the first day to agree the pick-up times.

If something is wrong, or you have a question, please contact {{office_contact}}. Please quote your booking reference.

Warm regards,
Hibiscus International Schools',
  '<p>Dear {{parent_first_name}},</p>'
  || '<p>Thank you. We have received your payment of {{amount_paid}} for school transport.</p>'
  || '<p>Booking reference: <strong>{{booking_reference}}</strong><br>Period: {{period}} ({{period_dates}})<br>Children: {{children}}</p>'
  || '<p>Your receipt is attached to this email. The transport provider will contact you before the first day to agree the pick-up times.</p>'
  || '<p>If something is wrong, or you have a question, please contact {{office_contact}}. Please quote your booking reference.</p>'
  || '<p>Warm regards,<br>Hibiscus International Schools</p>',
  array['parent_first_name', 'booking_reference', 'period', 'period_dates', 'children', 'amount_paid', 'office_contact'],
  true, 'transport'
)
on conflict (key, version) do nothing;

do $$
begin
  if not exists (select 1 from public.email_templates where key = 'transport_paid' and is_active and audience = 'transport') then
    raise exception 'the transport_paid email is missing';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'settings' and policyname = 'settings_update_transport'
  ) then
    raise exception 'the transport settings policy is missing';
  end if;
end
$$;
