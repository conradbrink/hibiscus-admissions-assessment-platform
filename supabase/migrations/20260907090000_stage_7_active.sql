-- Stage 7 exists. The school confirmed the primary phase runs Stage 1 to 7,
-- so the grade seeded inactive on 4 September is switched on. Its age rule
-- (turning 12) was seeded with it; the campus × grade rows for Broadhurst
-- and Block 7 were inserted by phase and already include it.
update public.grades set is_active = true where code = 'stage_7' and not is_active;
