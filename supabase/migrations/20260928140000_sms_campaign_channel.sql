-- SMS, as a campaign channel beside email and WhatsApp.
--
-- A campaign already chose email, WhatsApp or both. It may now choose any
-- mix of the three, still as one value so the guard, the list and the
-- reports keep reading one column: `sms`, `email_sms`, `whatsapp_sms` and
-- `all` join `email`, `whatsapp` and `both` (which stays WhatsApp and email).
--
-- The SMS is the campaign's own words, written with the same {{variables}}
-- as the email: an SMS needs no approval from Meta, so there is no template
-- to point at. It goes one way from the school's alphanumeric sender, so a
-- parent cannot reply to it, and a marketing SMS goes only to a contact who
-- consented to SMS (`contacts.sms_consent`, which the CRM already records).
--
-- Each SMS is a `messages` row with channel `sms`, so it is on the family's
-- timeline, its delivery comes back through the same webhook, and it is
-- counted on the campaign like the other two.

-- ---------------------------------------------------------------------------
-- The channel lists
-- ---------------------------------------------------------------------------

alter table public.campaigns drop constraint if exists campaigns_channel_check;
alter table public.campaigns add constraint campaigns_channel_check
  check (channel in ('email', 'whatsapp', 'both', 'sms', 'email_sms', 'whatsapp_sms', 'all'));

alter table public.campaign_recipients drop constraint if exists campaign_recipients_channel_check;
alter table public.campaign_recipients add constraint campaign_recipients_channel_check
  check (channel in ('email', 'whatsapp', 'sms'));

alter table public.messages drop constraint if exists messages_channel_check;
alter table public.messages add constraint messages_channel_check
  check (channel in ('whatsapp', 'sms'));

-- ---------------------------------------------------------------------------
-- The campaign's SMS
-- ---------------------------------------------------------------------------

alter table public.campaigns
  add column if not exists sms_body text,
  add column if not exists recipients_sms int;

-- Three parts at most: 459 characters of plain text, fewer with an emoji.
alter table public.campaigns drop constraint if exists campaigns_sms_body_length;
alter table public.campaigns add constraint campaigns_sms_body_length
  check (sms_body is null or char_length(sms_body) between 1 and 459);

comment on column public.campaigns.sms_body is
  'The SMS, in plain text with {{variables}}. Sent one way from the school''s SMS sender; null unless the channel includes SMS.';
comment on column public.campaigns.recipients_sms is
  'How many contacts the prepared list will text, as the approver saw it.';

-- The message is what was approved. `campaigns_guard_transition` freezes the
-- email and the WhatsApp template once a campaign leaves draft; the SMS is
-- frozen the same way, by its own trigger so the guard itself is untouched.
create or replace function public.campaigns_sms_locked()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'draft' and new.status <> 'draft' and new.sms_body is distinct from old.sms_body then
    raise exception 'campaign_locked';
  end if;
  return new;
end;
$$;

revoke all on function public.campaigns_sms_locked() from public, anon, authenticated;

drop trigger if exists campaigns_sms_locked on public.campaigns;
create trigger campaigns_sms_locked
  before update on public.campaigns
  for each row execute function public.campaigns_sms_locked();

-- ---------------------------------------------------------------------------
-- The switch and the sender
-- ---------------------------------------------------------------------------

-- Off until the school turns it on, like WhatsApp was. The sender is the
-- Zavu sender profile whose one-way SMS channel texts as the school; left
-- empty, the send uses the messaging sender (ZAVU_SENDER_ID).
insert into public.settings (key, value, description)
values
  ('sms_enabled', 'false'::jsonb,
   'Send SMS. When off, an SMS a campaign would send is skipped with the reason, and nothing reaches a parent.'),
  ('sms_sender_id', '""'::jsonb,
   'The Zavu sender profile SMS goes out as (its one-way SMS channel). Empty uses the messaging sender.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The campaign's results, SMS counted too
-- ---------------------------------------------------------------------------

create or replace function public.crm_campaign_stats(p_campaign_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with r as (
    select cr.*, e.status as email_status, m.status as message_status, m.contact_id as m_contact
      from public.campaign_recipients cr
      left join public.email_messages e on e.id = cr.email_message_id
      left join public.messages m on m.id = cr.message_id
     where cr.campaign_id = p_campaign_id
  ), c as (
    select started_at from public.campaigns where id = p_campaign_id
  )
  select jsonb_build_object(
    'total', (select count(*) from r),
    'pending', (select count(*) from r where status = 'pending'),
    'excluded', (select count(*) from r where status = 'excluded'),
    'sent', (select count(*) from r where status = 'sent'),
    'skipped', (select count(*) from r where status = 'skipped'),
    'failed', (select count(*) from r where status = 'failed'),
    'email', jsonb_build_object(
      'sent', (select count(*) from r where channel = 'email' and status = 'sent'),
      'delivered', (select count(*) from r where channel = 'email' and email_status in ('delivered', 'opened', 'clicked')),
      'opened', (select count(*) from r where channel = 'email' and email_status in ('opened', 'clicked')),
      'clicked', (select count(*) from r where channel = 'email' and email_status = 'clicked'),
      'bounced', (select count(*) from r where channel = 'email' and email_status = 'bounced'),
      'failed', (select count(*) from r where channel = 'email' and (status = 'failed' or email_status = 'failed'))
    ),
    'whatsapp', jsonb_build_object(
      'sent', (select count(*) from r where channel = 'whatsapp' and status = 'sent'),
      'delivered', (select count(*) from r where channel = 'whatsapp' and message_status in ('delivered', 'read')),
      'read', (select count(*) from r where channel = 'whatsapp' and message_status = 'read'),
      'failed', (select count(*) from r where channel = 'whatsapp' and (status = 'failed' or message_status = 'failed')),
      'replies', (
        select count(distinct m.contact_id)
          from public.messages m
          join r on r.contact_id = m.contact_id and r.channel = 'whatsapp' and r.status = 'sent'
         where m.direction = 'in'
           and m.received_at >= coalesce((select started_at from c), now())
      )
    ),
    'sms', jsonb_build_object(
      'sent', (select count(*) from r where channel = 'sms' and status = 'sent'),
      'delivered', (select count(*) from r where channel = 'sms' and message_status in ('delivered', 'read')),
      'failed', (select count(*) from r where channel = 'sms' and (status = 'failed' or message_status = 'failed'))
    )
  )
$$;

revoke execute on function public.crm_campaign_stats(uuid) from public, anon;
grant execute on function public.crm_campaign_stats(uuid) to authenticated;
