-- The school's card gateway is PayGate (Payfast by Network), reached through
-- its PayWeb 3 hosted page. The payments table learns the provider name;
-- the adapter lives in web/lib/payments/paygate.ts beside the DPO one.
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider in ('dev', 'dpo', 'paygate', 'bank'));
