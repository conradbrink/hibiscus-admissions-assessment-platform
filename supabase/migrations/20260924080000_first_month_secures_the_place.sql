-- The first instalment secures the place, and a scholarship is reviewed yearly.
--
-- Four changes that belong in one file because they are one promise: a
-- scholarship place is confirmed by a payment, and it is held for a year at a
-- time. Say one without the other and the letter is either a bill with no
-- reason or a condition with no consequence.
--
-- ---------------------------------------------------------------------------
-- 1. What a parent pays to confirm
-- ---------------------------------------------------------------------------
--
-- Until now the only lines marked `payable_at_acceptance` were the application
-- fee and the admission fee. Tuition was quoted per term and invoiced later,
-- so a family confirmed a place having paid P 2,300 and nothing towards the
-- teaching. For a scholarship child, whose award waives both of those, the
-- total due was **zero** — they ticked a box and the place was theirs.
--
-- The school wants the first instalment to confirm the offer. So every 2027
-- schedule that quotes tuition gains a `tuition_month` line marked payable at
-- acceptance, which is what `chargeAtAcceptance` reads: with a non-zero amount
-- due the /offer page routes the family to pay, and the place is not secured
-- until that payment lands. The letter then says so in words.
--
-- The monthly figure is the term divided by three. That is not a guess: the
-- scholarship letter already promises nine instalments across three terms,
-- which is three to a term. Where the division is not exact it rounds to the
-- thebe — Stage 1's P 17,000 a term becomes P 5,666.67 a month, which is not a
-- number anybody would choose, and the school may want a rounder one. It is
-- left as the arithmetic rather than rounded by me, because a figure invented
-- here is one nobody can trace back.
--
-- Only **2027** schedules are touched. The 2026 ones carry offers that are out
-- with families now; a sent offer keeps its own frozen snapshot and would not
-- change, but a new 2026 offer would, and changing what a mid-year family pays
-- is not what was asked for.
--
-- ---------------------------------------------------------------------------
-- 2. The scholarship discount has to reach the new line
-- ---------------------------------------------------------------------------
--
-- `applyPromotion` matches an effect to a fee line by `fee_code`, so a band
-- that discounts `tuition_term` does nothing at all to `tuition_month`.
-- Without the effect below, a 50% scholarship family would be asked for the
-- **full** first instalment while their termly figure showed half. Each band
-- gains the same percentage on the monthly line.
--
-- ---------------------------------------------------------------------------
-- 3. The scholarship letter, which would not have rendered at all
-- ---------------------------------------------------------------------------
--
-- Found while making the change: the live scholarship body uses
-- `{{fees_table}}` and `{{campus_whatsapp}}`, and **neither is in that
-- template's `allowed_variables`**. `renderHtml` throws `TemplateRenderError`
-- on a variable outside the allow-list, so the first time a staff member
-- pressed "Generate offer" for a scholarship child the draft would have failed
-- outright. No scholarship offer has ever been generated — every one of the 71
-- offers on file uses the standard template — so this has not reached a
-- family, but the first of 25 interviewed scholarship children would have hit
-- it. `{{scholarship_award}}` is a third trap: it is allowed, so it does not
-- throw, but `buildOfferVariables` never supplies it, so it renders as nothing
-- and the letter reads "holds a  scholarship".
--
-- The rewrite below uses only variables that are both allowed **and**
-- produced, and it is checked at the end of this migration against the same
-- rule the renderer applies.
--
-- ---------------------------------------------------------------------------
-- 4. Reviewed yearly
-- ---------------------------------------------------------------------------
--
-- The award is not unconditional and the letter should not read as though it
-- is. The conditions were listed in the invitation — academic standard, an
-- afternoon activity, representing the school, paying on time — but nothing
-- said who checks, or when. It is reviewed at the end of each academic year,
-- and that now appears in the body and in the terms, which is the part a
-- family signs up to.

-- ---------------------------------------------------------------------------
-- The monthly line
-- ---------------------------------------------------------------------------

insert into public.fee_lines (schedule_id, code, label, amount_minor, payable_at_acceptance, position)
select fs.id,
       'tuition_month',
       'Tuition per month',
       round(term.amount_minor / 3.0)::bigint,
       true,
       coalesce(term.position, 3) - 1
  from public.fee_schedules fs
  join public.academic_years ay on ay.id = fs.academic_year_id
  join public.fee_lines term on term.schedule_id = fs.id and term.code = 'tuition_term'
 where ay.label = '2027'
   and fs.status = 'active'
   and not exists (
     select 1 from public.fee_lines x where x.schedule_id = fs.id and x.code = 'tuition_month'
   );

-- ---------------------------------------------------------------------------
-- The scholarship bands discount it too
-- ---------------------------------------------------------------------------

insert into public.promotion_effects (promotion_id, position, kind, fee_code, percent, label)
select p.id,
       40,
       'discount_percent',
       'tuition_month',
       (regexp_replace(p.code, '\D', '', 'g'))::numeric,
       'Scholarship — ' || regexp_replace(p.code, '\D', '', 'g') || '% of the monthly fee'
  from public.promotions p
 where p.code like 'SCHOLARSHIP-%'
   and not exists (
     select 1 from public.promotion_effects e
      where e.promotion_id = p.id and e.fee_code = 'tuition_month'
   );

-- ---------------------------------------------------------------------------
-- The scholarship offer letter
-- ---------------------------------------------------------------------------

-- Written against the variables `buildOfferVariables` actually returns. The
-- award is named with `{{promotion_name}}` ("Scholarship — 30%") and described
-- with `{{promotion_text}}`, both of which come from the promotion row the
-- offer was drafted under, rather than the `{{scholarship_award}}` the old
-- letter asked for and never received.
--
-- The fee table prints waived lines rather than hiding them, because "Waived
-- (was P 2,000.00)" is the scholarship doing its work in front of the family;
-- a row that disappears looks like a fee the school forgot to charge.
--
-- `{{promotion_savings}}` is deliberately left out, though it is allowed and
-- populated. `applyPromotion` sums the saving on every line, and a schedule
-- that now quotes both a term and a month describes the same tuition twice —
-- a 30% award at Broadhurst Stage 3 to 7 would print "worth P 9,380.00" from
-- P 300 + P 2,000 + P 5,310 off the term + P 1,770 off the month. The figure
-- is not wrong arithmetic, it is the wrong question, and the letter is not
-- the place to answer it. `{{amount_due}}` is unaffected: it sums only lines
-- payable at acceptance, where tuition appears once.
update public.offer_templates
   set body_html = $html$<p style="margin:0 0 18px;padding-bottom:10px;border-bottom:1px solid #dddddd;font-size:12px;line-height:1.55;color:#444444;white-space:pre-line"><strong>Hibiscus Schools &middot; {{campus}}</strong>
{{campus_address}}</p><p><strong>SCHOLARSHIP OFFER: {{student_first_name}} {{student_last_name}}</strong></p><p>Dear {{parent_first_name}} {{parent_last_name}},</p><p>Congratulations! Following {{student_first_name}}'s interview, we are delighted to offer <strong>{{student_first_name}} {{student_last_name}}</strong> a place in our <strong>{{grade}}</strong> class at <strong>{{campus}}</strong> for <strong>{{intake}}</strong>. {{#if intake_not_started}}The term starts on {{start_date}}.{{/if}}{{#if intake_started}}The term started on {{start_date}}.{{/if}}</p>{{#if promotion_name}}<p><strong>{{student_first_name}} holds a {{promotion_name}} scholarship.</strong>{{#if promotion_text}} {{promotion_text}}{{/if}} The fees below are what remains after it.</p>{{/if}}<p><strong>Places on the scholarship programme are limited.</strong> The offer is confirmed when the first monthly instalment has been paid — that payment is the condition of acceptance, and {{student_first_name}}'s place is held for somebody else until we receive it.</p><table class="details">{{#if registration_fee}}<tr><td>Application fee</td><td>{{registration_fee}}</td></tr>{{/if}}{{#if admission_fee}}<tr><td>Admission fee</td><td>{{admission_fee}}</td></tr>{{/if}}{{#if tuition_term}}<tr><td>Tuition per term, after the scholarship</td><td>{{tuition_term}}</td></tr>{{/if}}{{#if tuition_month}}<tr><td>Tuition per month, after the scholarship</td><td>{{tuition_month}}</td></tr>{{/if}}<tr><td><strong>Payment to confirm the offer &mdash; the first instalment</strong></td><td><strong>{{amount_due}}</strong></td></tr></table><p>The balance follows in the remaining eight instalments across the year, invoiced by the school. These fees cover tuition. <strong>School uniform and books are not included</strong>; the school invoices for them separately, and will tell you what is needed and what it costs before the term begins.</p>{{#if bank_details}}<p><strong>Account details:</strong> {{bank_details}}. Please use the reference <strong>{{reference_to_use}}</strong> &mdash; the child's name &mdash; when you pay, then send proof of payment to the admissions office.</p>{{/if}}<h2>Keeping the scholarship</h2><p>The award is made for one academic year at a time and is <strong>reviewed at the end of each year</strong>. It continues into the year ahead when {{student_first_name}} has kept to the conditions of the programme:</p><ul><li>a strong work ethic and good academic results;</li><li>taking part in at least one afternoon activity;</li><li>representing Hibiscus Schools positively, as an ambassador for the school;</li><li>fees paid on time, according to the instalment plan;</li><li>meeting the Student Code of Conduct, and the Parent Code of Conduct for parents and guardians.</li></ul><p>We will write to you after each review to confirm the award for the year ahead. Where something has slipped we will talk to you first &mdash; a review is a conversation, not a letter out of the blue.</p>{{#if conditions}}<p><strong>This offer is also made on the following conditions:</strong> {{conditions}} Please contact the admissions office if you would like to discuss any of them.</p>{{/if}}<p>Please tell the school office if your contact details change, so that you receive all our messages.</p><p>This offer is open until <strong>{{offer_expiry_date}}</strong>. Application reference: {{application_reference}}. If you would like to talk to somebody first, call us on {{campus_phone}}.</p><p>We look forward to welcoming {{student_first_name}}.</p><p>Kind regards,<br><strong>Roelien Brink</strong><br>C.E.O., Hibiscus Schools</p>$html$,
       terms_html = $terms$<h2>Terms</h2><p>{{student_first_name}}'s place is confirmed when the first monthly instalment shown in this letter has been paid in full. The application fee and the admission fee are waived under the scholarship programme. Fees are in {{currency}} and are not refundable. The scholarship is awarded for one academic year and is reviewed at the end of each year against the conditions set out in this letter; where they have not been met the school may reduce or withdraw the award for the year ahead, and will discuss that with the family before it does. Where the offer lists further conditions, the place depends on the family meeting them by the time stated, or the school may withdraw it. The school invoices the remaining instalments following its published fee schedule and payment options. Admission follows the school's policies. The parent or guardian accepts these policies at registration.</p>$terms$,
       updated_at = now()
 where key = 'scholarship';

-- ---------------------------------------------------------------------------
-- The invitation email must stop saying there is nothing to pay
-- ---------------------------------------------------------------------------

-- Twenty-five families were told on 23 September that there was nothing to pay
-- to accept. That sentence is now wrong, and leaving it in place for the
-- families still to be invited would repeat the error. Anchored on the exact
-- sentence and checked, because a silent no-op here is how a promise outlives
-- the thing that made it true.
do $$
declare
  v_old_text constant text := 'There is nothing to pay to accept this place. The application fee and the admission fee are both waived.';
  v_new_text constant text := 'The application fee and the admission fee are both waived. To confirm the place, the first monthly instalment is payable on acceptance; the balance follows in the remaining eight instalments.';
  v_hit int;
begin
  update public.email_templates
     set body_text = replace(body_text, v_old_text, v_new_text),
         body_html = replace(body_html, v_old_text, v_new_text),
         updated_at = now()
   where key = 'scholarship_invitation'
     and (position(v_old_text in body_text) > 0 or position(v_old_text in body_html) > 0);

  get diagnostics v_hit = row_count;
  if v_hit = 0 then
    raise exception 'The scholarship invitation no longer contains the "nothing to pay" sentence; check the wording by hand in Settings before relying on this.';
  end if;

  raise notice 'scholarship_invitation: % row(s) reworded', v_hit;
end $$;

-- ---------------------------------------------------------------------------
-- Prove it
-- ---------------------------------------------------------------------------

do $$
declare
  v_missing text;
  v_undiscounted text;
  v_unknown text;
begin
  -- Every 2027 schedule that quotes a term now quotes a month, payable up front.
  select string_agg(fs.name, ', ' order by fs.name) into v_missing
    from public.fee_schedules fs
    join public.academic_years ay on ay.id = fs.academic_year_id
    join public.fee_lines term on term.schedule_id = fs.id and term.code = 'tuition_term'
   where ay.label = '2027' and fs.status = 'active'
     and not exists (
       select 1 from public.fee_lines m
        where m.schedule_id = fs.id and m.code = 'tuition_month' and m.payable_at_acceptance
     );
  if v_missing is not null then
    raise exception 'no monthly line payable at acceptance on: %', v_missing;
  end if;

  -- Every scholarship band discounts it, or a family pays the full instalment.
  select string_agg(p.code, ', ' order by p.code) into v_undiscounted
    from public.promotions p
   where p.code like 'SCHOLARSHIP-%' and p.is_active
     and not exists (
       select 1 from public.promotion_effects e
        where e.promotion_id = p.id and e.fee_code = 'tuition_month' and e.kind = 'discount_percent'
     );
  if v_undiscounted is not null then
    raise exception 'these bands would charge the full first instalment: %', v_undiscounted;
  end if;

  -- The rule `renderHtml` applies: every {{name}} and {{#if name}} in an
  -- active template must be in that template's allow-list, or the render
  -- throws and the staff member sees a failed draft rather than a letter.
  -- This is the check that was missing when `{{fees_table}}` went in.
  select string_agg(distinct t.key || ': ' || v, ', ') into v_unknown
    from public.offer_templates t
    cross join lateral regexp_matches(
      coalesce(t.body_html, '') || coalesce(t.terms_html, ''),
      '\{\{\s*(?:#if\s+)?([a-z][a-z0-9_]*)\s*\}\}', 'g'
    ) as m(parts)
    cross join lateral (select m.parts[1]) as x(v)
   where t.is_active and not (v = any (t.allowed_variables));
  if v_unknown is not null then
    raise exception 'offer templates use variables that are not allowed, so they cannot render: %', v_unknown;
  end if;

  raise notice 'first instalment payable at acceptance on every 2027 tuition schedule, every scholarship band discounts it, and every active offer template renders';
end $$;
