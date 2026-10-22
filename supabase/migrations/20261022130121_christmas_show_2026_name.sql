-- The Christmas Show is in December 2026, so its name says 2026.
--
-- 20261022100000_event_tickets.sql seeded it as "Hibiscus Christmas Show
-- 2027". The school asked on 22 October 2026 for 2026 instead. Only the
-- name changes: the date, the prices and the sales stay as they are.
update public.crm_events e
   set name = 'Hibiscus Christmas Show 2026'
  from public.event_sales s
 where s.event_id = e.id
   and s.slug = 'christmas-show'
   and e.name = 'Hibiscus Christmas Show 2027';
