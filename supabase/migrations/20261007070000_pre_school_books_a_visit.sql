-- Pre-school books a visit, not a play date.
--
-- The school decided the pre-school families should be invited to see the
-- school on the same terms as everybody else. `lib/booking/noun.ts` now
-- answers "visit" where it answered "play date", which carries the word
-- through every screen, email subject and WhatsApp body that asks it — and
-- routes the confirmation and the reschedule to `visit_confirmed` and
-- `visit_moved`, both already approved with Zavu, so nothing goes back to
-- Meta for this.
--
-- What the noun cannot reach is wording typed into a template body. One live
-- template still says the words: the pre-school enquiry acknowledgement, whose
-- email offers "you can book a play date" above a link labelled "Book a play
-- date". Its WhatsApp counterpart was already reworded to "see the campus
-- first" by 20260921120000 and needs nothing here.
--
-- A targeted replace rather than a rewritten body, because that body has been
-- amended twice since it was written (the manned-number paragraph, the
-- updates-line wording) and restating it here would silently revert whichever
-- amendment this migration was written before.
--
-- `email_templates` keys are not unique — four rows carry this key and one is
-- active — so this touches every row with the word, leaving the inactive
-- history consistent rather than half-corrected. `playdate_confirmed` and
-- `playdate_moved` are deliberately left alone, in both tables: nothing routes
-- to them now, and an approved template costs nothing to keep while deleting
-- one would mean a fresh Meta submission if the school ever wants the warmer
-- pre-school wording back.

update public.email_templates
   set body_html = replace(replace(body_html, 'book a play date', 'book a visit'), 'Book a play date', 'Book a visit'),
       body_text = replace(replace(body_text, 'book a play date', 'book a visit'), 'Book a play date', 'Book a visit'),
       updated_at = now()
 where key = 'preschool_enquiry_received'
   and (body_html like '%play date%' or body_text like '%play date%');

-- Nothing anywhere should still offer a parent a play date.
do $$
declare
  stragglers int;
begin
  select count(*) into stragglers
    from public.email_templates
   where is_active
     and (body_html ilike '%play date%' or body_text ilike '%play date%' or subject ilike '%play date%')
     and key not in ('playdate_confirmed', 'playdate_moved');
  if stragglers > 0 then
    raise exception 'an active email template still offers a play date (% rows)', stragglers;
  end if;
end $$;
