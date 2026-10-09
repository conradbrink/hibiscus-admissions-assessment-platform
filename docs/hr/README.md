# Hibiscus HR

The HR app lives in `hr/`. It is a separate Next.js application, deployed as
its own Vercel project, on the **same Supabase database** as admissions: one
set of staff accounts, roles and campuses. Its screens never appear inside the
admissions console, and admissions screens never appear in it.

| | |
|---|---|
| Careers page | `/vacancies`, `/vacancies/<post>` |
| Application form | `/apply` (reached by an emailed link, `/h/<token>`) |
| Referee form | `/reference` (reached by an emailed link, `/r/<token>`) |
| Staff console | `/staff` (the same email and password as admissions) |

Rules for working on it: `hr/AGENTS.md`. Design notes: `TIME_TO_VALUE.md`
(the application form) and `OBJECTIONS.md` (the careers page).

## Phase 1: recruitment (built)

1. **A vacancy** is drafted by HR. It starts with the core questions of its
   phase's bank (Pre-school, Primary or Secondary; banks in
   `supabase/migrations/20261012090300_hr_question_banks.sql`). The AI can
   tailor the draft to the post. **A person approves every question**, and
   publishing freezes the questions and the scoring weights.
2. **The applicant** starts with name, email and consent, gets a link by email
   at once, and fills seven short sections in any order: about you,
   qualifications, career history (dates, so tenure is computed), permission
   to teach (SACE or BTPC, work permit, police clearance, the safeguarding
   declaration), documents (CV required), the written questions, and two or
   three referees (one from the most recent employer).
3. **Before the questions open**, the applicant ticks a notice that every
   answer is checked for AI-written text. While they type, the answer box
   records how the answer was written (typing time, keystrokes, characters
   pasted, tab switches).
4. **On submit**, each referee is emailed a four-minute questionnaire
   (ratings, the safeguarding question, would you re-employ, do you
   recommend), with reminders on day 3 and day 7 and expiry on day 14. Every
   application is marked by AI against the rubrics and checked for AI-written
   answers (behaviour, an AI review, and a near-duplicate comparison with
   every other applicant).
5. **The score** is out of 100 in five qualities: qualifications and
   compliance 25, experience and stability 20, interview answers 30,
   references 15, communication 10. A quality with no data yet is left out
   ("62 / 85 so far"). **Flags never change the number**: a referee's concern,
   a declared record, a missing registration or a possible AI-written answer
   is a red or amber chip for a person to read.
6. **The pipeline** has three columns: Review, Shortlisted, Unsuccessful.
   Moving a card emails the applicant only if the person ticks the box. From
   Shortlisted: invite to interview (with a calendar invitation), email an
   offer, mark as hired.
7. **Retention**: unfinished drafts are removed after 30 days; unsuccessful
   and withdrawn applicants are anonymised after 12 months (24 with
   talent-pool consent). Hired applicants are kept.

## Phase 2: employees and pay (next)

Employee records (created on hire), contracts and probation, documents with
expiry dates, leave, disciplinary cases with hearings and warnings,
timesheets, payroll with Botswana PAYE and South African PAYE, UIF and SDL
from versioned tax tables, payslips printed in bulk per month, and exports.

## Deploying

See `DEPLOY-HR.md`.
