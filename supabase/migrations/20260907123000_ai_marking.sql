-- Automatic marking of written answers.
--
-- The school asked (7 September 2026) for every answer to be marked on
-- submission, the written ones by the model against the question's rubric.
-- A mark the model gives is recorded with marking_method 'ai', shown on the
-- attempt page with its rationale, and can be overridden by a person, whose
-- mark then stands ('rubric'). The switch below turns it on; it only takes
-- effect when AI_PROVIDER is a real provider, because the development
-- adapter's answer is a placeholder and must never mark a child.

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.attempt_responses'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%marking_method%'
  loop
    execute format('alter table public.attempt_responses drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.attempt_responses
  add constraint attempt_responses_marking_method_check
  check (marking_method is null or marking_method in ('auto', 'rubric', 'ai'));

insert into public.settings (key, value, description)
values
  ('ai_auto_mark_enabled', 'true'::jsonb,
   'Mark written answers automatically on submission, using the AI against each question''s rubric and model answer. A person can override any mark on the attempt page. Only effective when the site runs with a real AI provider; otherwise the answers wait for a person as before.')
on conflict (key) do nothing;
