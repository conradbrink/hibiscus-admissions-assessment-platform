-- Science joins English and Mathematics as an assessed subject, for the
-- Cambridge Progression papers the school sits with Stage 4 to 7 entrants.
-- Four strands, one per Cambridge content area plus working scientifically.

insert into public.subjects (code, name, sort_order) values
  ('science', 'Science', 30)
on conflict (code) do nothing;

insert into public.competencies (subject_id, code, name, focus_label, sort_order)
select s.id, c.code, c.name, c.focus_label, c.sort_order
from (values
  ('science', 'science_biology',   'Biology',                'Living things',          10),
  ('science', 'science_chemistry', 'Chemistry',              'Materials and changes',  20),
  ('science', 'science_physics',   'Physics',                'Forces, energy and space', 30),
  ('science', 'science_enquiry',   'Working scientifically', 'Scientific enquiry',     40)
) as c(subject_code, code, name, focus_label, sort_order)
join public.subjects s on s.code = c.subject_code
on conflict (code) do nothing;
