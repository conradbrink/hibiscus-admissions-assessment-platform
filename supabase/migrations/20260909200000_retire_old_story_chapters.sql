-- The Tumi chapters move up a grade, and the old ones stand down.
--
-- The school found the sittings too hard for the age they were set at, so
-- every chapter now serves the grade above the one it was written for: The
-- river becomes Stage 1's, The village Stage 2's, The market Stage 3's, and a
-- gentler new chapter — The garden — is written for Reception. The hill,
-- which was Stage 3's, has nowhere left to go and is retired rather than
-- deleted, so it can come back if a Stage 4 sitting is ever wanted.
--
-- The chapters are keyed by their story now (river, village, market, hill,
-- garden) rather than by a grade they no longer match; a file called
-- `stage1.json` holding Stage 2's assessment is a trap for whoever edits it
-- next. That re-keying makes new template rows, so the four old ones are
-- stood down here. Nothing is deleted: a sitting already taken snapshots its
-- own questions at launch and is unaffected either way.
--
-- The content itself lives in web/content/story/*.json and is loaded by
-- web/scripts/story-seed.mjs, which is run after this.

update public.assessment_templates
   set status = 'draft',
       name = name || ' (superseded)'
 where delivery = 'story'
   and id in (
     md5('story:template:reception')::uuid,
     md5('story:template:stage1')::uuid,
     md5('story:template:stage2')::uuid,
     md5('story:template:stage3')::uuid
   )
   and status <> 'draft';

-- A grade with two active story chapters would leave the launcher choosing
-- between them, so this refuses to finish rather than leave that behind.
-- It runs before the new chapters are seeded, so it is checking that the old
-- ones really did stand down.
do $check$
declare
  v_grade int;
  v_count int;
begin
  select grade_sort_min, count(*) into v_grade, v_count
    from public.assessment_templates
   where delivery = 'story' and status = 'active'
   group by grade_sort_min
  having count(*) > 1
   limit 1;
  if found then
    raise exception 'Grade % still has % active story chapters.', v_grade, v_count;
  end if;
end
$check$;
