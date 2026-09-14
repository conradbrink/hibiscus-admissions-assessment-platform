-- ---------------------------------------------------------------------------
-- How long we wait on a checkout the parent started
-- ---------------------------------------------------------------------------

-- A parent opened PayGate's page, did not pay, and closed it. PayGate answers
-- `NO_TRANS_DATA` — it has no transaction at all — which we read, correctly,
-- as "not yet". The trouble was how long "not yet" lasted: `expires_at` was
-- the gateway's own 24-hour checkout window, so the row sat in `processing`
-- for a day while the sweep asked again every few minutes and got the same
-- answer thirteen times.
--
-- This is our patience, not the gateway's. The hosted page can stay open as
-- long as PayGate likes; we stop calling a payment live after this many
-- minutes and set it back to "not paid" so the family can try again and the
-- office can see where they stand.
--
-- Five rather than one. A card with 3-D Secure routinely takes two to five
-- minutes — the parent is on their bank's one-time-password screen — and a
-- minute would call a real payment dead while they were still typing. The
-- first check is due a minute in and runs at the next drain, which is the
-- five-minute cron at worst; this is only when we give up, and the give-up is
-- likewise made by the first drain after the window closes.
--
-- Giving up is safe to get wrong in one direction only, and it is the safe
-- one: a notify that arrives afterwards, or a member of staff pressing Check
-- with gateway, asks again and settles a payment that did land. Money is
-- never lost to this timer, only optimism about it.
insert into public.settings (key, value, description)
values ('payment_attempt_minutes', '5', 'Minutes we keep waiting on a checkout the parent started before marking it not paid. A payment that lands later still settles.')
on conflict (key) do nothing;
