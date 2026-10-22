-- Who was at the desk when an agreement was signed.
--
-- The school asked on 22 October 2026 for staff to be able to fill in a
-- registration for or with a family (`startAssistedRegistration`). The
-- parent still types their name and draws their signature, on the school's
-- computer. Without this column the row would read as though the family
-- signed alone, from an address and a browser that are the school's: the
-- record of what was signed would be quietly wrong about how.
--
-- Null for every signature made on the family's own link, which is every row
-- before today. A member of staff removed later leaves the signature standing
-- and the name gone, as an uploaded document does
-- (`documents.uploaded_by_staff_id`).

alter table public.agreement_acceptances
  add column if not exists witnessed_by_staff_id uuid references public.staff_profiles(id) on delete set null;

comment on column public.agreement_acceptances.witnessed_by_staff_id is
  'The member of staff who opened the assisted session the agreement was signed in; null when the family signed on their own link.';
