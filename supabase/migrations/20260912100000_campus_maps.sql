-- "Where is it?" answered with a map rather than a plot number.
--
-- Every campus already carries an address, and every "where to go" email
-- prints it. A plot number in Gaborone is not something a parent can drive to
-- without looking it up, and on a phone the useful thing is a link that opens
-- the maps app.
--
-- One column, and a line in the six emails that already tell a family where to
-- go. The line is wrapped in `{{#if campus_maps_url}}` so a campus without a
-- link yet loses the line rather than printing an empty "Directions:".

alter table public.campuses
  add column if not exists maps_url text;

alter table public.campuses drop constraint if exists campuses_maps_url_check;
alter table public.campuses add constraint campuses_maps_url_check
  check (maps_url is null or (maps_url ~ '^https://' and length(maps_url) <= 500));

comment on column public.campuses.maps_url is
  'A link that opens this campus in a maps app. Shown to parents beside the address. Null: the address stands on its own and the directions line is omitted.';

-- The links the school gave, by campus code — all eight of the campuses that
-- existed when this was written. A ninth (Potch South) arrives in the
-- next migration carrying its own.
update public.campuses set maps_url = 'https://maps.app.goo.gl/3G1QmxsSuTKxP4GA7' where code = 'broadhurst' and maps_url is null;
update public.campuses set maps_url = 'https://maps.app.goo.gl/C5H6y6JWWqiA6G4u8' where code = 'block7' and maps_url is null;
update public.campuses set maps_url = 'https://maps.app.goo.gl/g8Z4BKdFyYErjDJ76' where code = 'sarona_city' and maps_url is null;
update public.campuses set maps_url = 'https://maps.app.goo.gl/ezeaR2H6R818Q1qf6' where code = 'phase2' and maps_url is null;
update public.campuses set maps_url = 'https://maps.app.goo.gl/KiDevZAyPEcmbpi1A' where code = 'phase4' and maps_url is null;
update public.campuses set maps_url = 'https://maps.app.goo.gl/u2jxcx1sSJkeGYQj9' where code = 'tlokweng' and maps_url is null;
update public.campuses set maps_url = 'https://maps.app.goo.gl/2n1hU8qe7AtTgN6X8' where code = 'village' and maps_url is null;
update public.campuses set maps_url = 'https://maps.app.goo.gl/HtWEZFNhETNrntAY9' where code = 'potch' and maps_url is null;

-- ---------------------------------------------------------------------------
-- The emails that tell a family where to go
-- ---------------------------------------------------------------------------

-- Spliced in after the address rather than by rewriting six bodies, so the
-- wording the school has edited since is kept. Every one of these uses the
-- bare `{{campus_address}}` token, checked before this was written.
--
-- Four of the six already wrap the address in `{{#if campus_address}}`. The
-- renderer resolves `#if` blocks innermost-first, so a block inside a block is
-- fine (lib/email/render.ts).
update public.email_templates
   set body_text = replace(
         body_text,
         '{{campus_address}}',
         '{{campus_address}}{{#if campus_maps_url}}' || E'\nDirections: {{campus_maps_url}}' || '{{/if}}'
       ),
       body_html = replace(
         body_html,
         '{{campus_address}}',
         '{{campus_address}}{{#if campus_maps_url}}<br><a href="{{campus_maps_url}}">Get directions</a>{{/if}}'
       ),
       allowed_variables = allowed_variables || array['campus_maps_url']
 where is_active
   and 'campus_address' = any(allowed_variables)
   and not ('campus_maps_url' = any(allowed_variables))
   and body_text like '%{{campus_address}}%';

-- The WhatsApp companions are deliberately untouched. Their wording is
-- approved by Zavu and a change means resubmitting all six for approval; the
-- link belongs where a parent can tap it in a message they keep, which is the
-- email, and on the confirmation page they are sent to.
