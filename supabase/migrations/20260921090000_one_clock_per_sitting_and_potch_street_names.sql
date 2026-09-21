-- Two unrelated things the school asked for on the same day.
--
-- 1. An assessment has one clock, for the whole sitting.
--
-- The Cambridge papers ran three parts at 15, 13 and 12 minutes and the Form
-- intake tests ran two at 20 each. In both cases the parts summed exactly to
-- the whole sitting, so the split bought the school nothing and cost a child
-- real marks: one who needed twenty minutes on the English part was pushed
-- on at fifteen, even when they would have finished the Maths part in ten and
-- handed back the difference. The trade is the child's to make now.
--
-- The runner no longer reads a section's limit, so nulling these rows is what
-- the screen already does; the point of writing it is that a future editor
-- opening the table does not find a number that looks live. The column stays.
-- Dropping it would rewrite the delivery view for no gain, and an assessment
-- already sat keeps its own record either way: `attempts.time_limit_seconds`
-- is the clock that ran, and it is untouched.
--
-- 2. The two Potchefstroom campuses are named for their streets.
--
-- "Potch CBD" and "Potch South" told a family nothing about where to drive.
-- The school calls them by street, so the letter should too. Only the display
-- name changes: the codes `potch` and `potch_south` are what every foreign
-- key, fee schedule and bank instruction hangs off, and they stay.
--
-- An offer already drafted froze the old name into its letter. The ones still
-- waiting for approval are re-rendered alongside this; an offer already sent
-- or accepted keeps the name it was sent under, because that is the document
-- the family holds.

update public.template_sections
   set time_limit_minutes = null
 where time_limit_minutes is not null;

update public.campuses set name = 'Potch Maury Avenue'  where code = 'potch';
update public.campuses set name = 'Potch Rivier Street' where code = 'potch_south';
