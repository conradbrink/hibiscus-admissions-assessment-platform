-- The offer letter is signed by the head of the campus that makes the
-- offer. Each campus carries the head's name and title and a signature
-- image, uploaded by an administrator under Settings > Campuses and stored
-- inline as a data URL (a small PNG; no storage bucket to secure). A campus
-- without a signature prints the closing as before.

alter table public.campuses
  add column if not exists head_name text,
  add column if not exists head_title text,
  add column if not exists signature_data_url text;

alter table public.campuses drop constraint if exists campuses_signature_data_url_check;
alter table public.campuses add constraint campuses_signature_data_url_check check (
  signature_data_url is null
  or (signature_data_url like 'data:image/png;base64,%' or signature_data_url like 'data:image/jpeg;base64,%')
  and length(signature_data_url) <= 600000
);
