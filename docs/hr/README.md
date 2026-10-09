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
| Employee payslip | `/payslip` (reached by an emailed link, `/p/<token>`) |

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

## Phase 2: employees and pay (built)

1. **Employees.** Pressing Hire on a shortlisted applicant creates their
   employee record (number `HIS-00001` onwards) and carries over their
   teacher registration, work permit and police clearance. People who joined
   before the system are added under Employees. Each person's page shows
   their details, contracts, personal details (only with the personal details
   permission), pay, leave and disciplinary record.
2. **Pay set-up.** Basic pay (monthly or hourly) starts from a date, so a
   raise never changes an old month. Allowances and deductions (housing,
   transport, pension, medical aid, staff loans, school fees and others)
   also have start and end dates. A change of bank details must be confirmed
   by a second person.
3. **Timesheets.** One sheet per school per month. Monthly staff only need a
   row for overtime (1.5 times), Sunday or public holiday work (2 times) or
   unpaid days. Hourly staff need their hours.
4. **Payroll.** One run per school per month: work out pay, check it,
   correct any line with a reason, then **a second person approves it**. The
   database refuses the preparer as approver, and nothing in an approved run
   can change. Tax is worked out by the annualised method: Botswana PAYE
   (resident and non-resident), South African PAYE with rebates by age and
   medical tax credits, UIF up to its ceiling and SDL when the payroll is
   above the threshold. Pension and retirement contributions reduce tax up to
   the legal limit.
5. **Tax tables.** Stored as data, one per tax year. Each new year arrives as
   a **draft**, which payroll refuses. A payroll officer checks every figure
   against the SARS or BURS table, corrects it if needed, and publishes it.
   A published table cannot change. **The 2026/27 tables are seeded as drafts
   and must be checked before the first payroll.**
6. **Payslips.** The whole month prints as one PDF, one page per person.
   After approval, HR can email everyone a link to their own payslip; the
   link opens that one payslip only, for 60 days.
7. **Exports.** For an approved run: the bank payment file, a journal for the
   accounts, and the tax figures (EMP201 for South Africa, the PAYE return
   for Botswana), as CSV.
8. **Leave.** Annual, sick, family responsibility (South Africa),
   compassionate (Botswana), maternity, parental, study and unpaid. Days left
   are worked out from the year's allowance (a share of it for someone who
   starts part way through the year) and the leave already approved. HR
   records requests and approves or declines them; the employee is emailed
   the decision.
9. **Disciplinary.** A case per matter, with a record that can only be added
   to: notes, evidence, the hearing, the outcome and any appeal. A verbal or
   written warning counts for 6 months and a final written warning for 12,
   then stays on the record as expired.
10. **The dashboard** shows leave waiting for a decision, payroll waiting for
    approval, and contracts, probations, registrations and permits ending in
    the next 60 days.

**Who sees pay.** Salaries, bank details, payroll runs and payslips need the
payroll permissions, checked by `hr_has_strict()`, which ignores the
admissions `admin` permission. HR staff without them see none of it.

**Not built yet:** uploading documents to an employee's file (the table and
expiry dates are ready), performance and probation reviews, and staff asking
for leave themselves.

## Deploying

See `DEPLOY-HR.md`.
