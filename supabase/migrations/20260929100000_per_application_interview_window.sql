-- An interview window of its own, for an application that needs one.
--
-- A scholarship family books its interview up to one date for everyone, the
-- `scholarship_interview_deadline` setting. The primary families invited
-- late are given different dates, Monday 12 to Friday 23 October, and moving
-- the setting would move it for every family who has already been written to.
-- So the window can sit on the application: the booking page offers only
-- sessions inside it, the booking itself is refused outside it, and the
-- letter and the WhatsApp name its last day. Null on either end means "as
-- before": no earliest date, and the setting as the latest.
--
-- Written by the import (service role) only. Staff have no update grant on
-- `applications` (20260904120200_applications.sql), and none is added here.

alter table public.applications
  add column if not exists interview_window_from date,
  add column if not exists interview_window_to date;

alter table public.applications drop constraint if exists applications_interview_window_order;
alter table public.applications add constraint applications_interview_window_order
  check (interview_window_from is null or interview_window_to is null or interview_window_from <= interview_window_to);

comment on column public.applications.interview_window_from is
  'The first day this family may come for its interview or visit. Null: no earliest day.';
comment on column public.applications.interview_window_to is
  'The last day this family may come for its interview or visit, in place of the scholarship_interview_deadline setting. Null: the setting.';
