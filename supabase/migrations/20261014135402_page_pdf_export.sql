-- Download any staff page as a PDF.
--
-- Asked for on 14 October 2026, after the applicant-list download: "a pdf
-- export on the pages, and have it as a permission". Every staff page, in the
-- admissions console and the CRM, gets a Download PDF button in the strip at
-- the top. It saves the page as it is on screen, without the menus, through
-- the browser's own print-to-PDF, and each press is written to the audit log
-- (`page.pdf_downloaded`, with the page's path).
--
-- Its own permission, so the school can tick it per role (Settings → Staff
-- and roles) apart from the list downloads (`applications.export`) and the
-- data exports (`data.export`). Granted to Management and the admissions
-- manager to start with; the super administrator holds `admin`, which
-- satisfies every check.
--
-- Nothing reads it in a policy: the page shows only what this person may
-- already see, and the permission decides whether the button is offered and
-- the press is recorded. Anyone can still print from the browser's own menu;
-- this is the school's button, not a lock.
insert into public.permissions (code, label, sort_order)
values ('pages.export_pdf', 'Download any staff page as a PDF', 161)
on conflict (code) do update set label = excluded.label, sort_order = excluded.sort_order;

insert into public.role_permissions (role_id, permission_code)
select r.id, 'pages.export_pdf'
  from public.roles r
 where r.code in ('management', 'admissions_manager')
on conflict do nothing;

do $$
begin
  if (select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
       where rp.permission_code = 'pages.export_pdf' and r.code in ('management', 'admissions_manager')) <> 2 then
    raise exception 'management and the admissions manager should both be able to download a page as a PDF';
  end if;
end $$;
