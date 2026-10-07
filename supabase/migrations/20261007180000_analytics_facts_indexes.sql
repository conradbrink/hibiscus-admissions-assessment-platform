-- Two indexes the analytics facts view has been missing, and why it mattered.
--
-- `v_application_facts` carries one scalar subquery per application for the
-- latest offer and for the money actually paid. Neither `offers` nor
-- `payment_requests` had a plain index on `application_id` — only partial
-- unique ones, which the planner cannot use for an unqualified lookup — so
-- each of those subqueries fell back to a sequential scan, once per row.
-- Over three hundred applications that is three hundred scans of each table,
-- and the whole query passed the `authenticated` role's eight-second
-- statement timeout. PostgREST answered 500, and the analytics page, which
-- read only `data` and never `error`, drew every figure as zero.
--
-- Additive and small: both tables are in the hundreds of rows, so the build
-- is immediate and no existing query plan can get worse for having them.

create index if not exists offers_application_idx
  on public.offers (application_id, created_at desc);

create index if not exists payment_requests_application_idx
  on public.payment_requests (application_id);

analyze public.offers;
analyze public.payment_requests;
