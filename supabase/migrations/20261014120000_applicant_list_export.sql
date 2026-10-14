-- Download an applicant list as Excel or PDF.
--
-- Asked for on 14 October 2026 alongside the analytics drill-down: a manager
-- clicks a figure ("Offer sent, 8"), sees exactly those eight families, and
-- wants to take the list into a report or a meeting. Every applicant list
-- (a stage, a status, a search, or a figure opened from analytics) now has
-- an Excel and a PDF download; the route is
-- web/app/staff/(console)/applications/export/route.ts.
--
-- Its own permission rather than `data.export`, which carries the analytics
-- download and the per-child JSON: a list of families with their email
-- addresses is personal data leaving the system, and the school wants to
-- tick it for a person's role on its own (Settings → Staff and roles).
-- Granted to Management, whose function it is, and to the admissions
-- manager, who already holds the other admissions downloads. The super
-- administrator holds `admin`, which satisfies every check.
--
-- Nothing reads the permission in a policy: the download reads the rows
-- through the caller's own client, so what it holds is what the list on
-- screen holds, campus scoping included. The permission decides only whether
-- the buttons are offered and the route answers.
insert into public.permissions (code, label, sort_order)
values ('applications.export', 'Download applicant lists as Excel or PDF', 28)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

insert into public.role_permissions (role_id, permission_code)
select r.id, 'applications.export'
  from public.roles r
 where r.code in ('management', 'admissions_manager')
on conflict do nothing;

do $$
begin
  if (select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
       where rp.permission_code = 'applications.export' and r.code in ('management', 'admissions_manager')) <> 2 then
    raise exception 'management and the admissions manager should both be able to download an applicant list';
  end if;
end $$;
