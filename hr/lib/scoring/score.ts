import type { ScoringWeights } from "@/lib/settings";
import type { TenureSummary } from "@/lib/recruitment/tenure";

/**
 * The score out of 100, in five qualities, and the flags a person must look
 * at.
 *
 * Deterministic: the only AI inputs are the bands on written answers and on
 * communication, and a person's band replaces the AI's wherever one exists.
 * A quality with no data yet (references still out, answers not yet marked)
 * is left out of the total rather than counted as zero, and the total says so
 * ("62 of 85 available"), so an early score is never mistaken for a low one.
 *
 * **Flags never change the number.** A safeguarding concern is not 10 points
 * off; it is a red line on the card that a person must read. The AI-writing
 * check is a flag for the same reason.
 *
 * Pure. Unit tested.
 */

export type Country = "BW" | "ZA";
export type Phase = "preschool" | "primary" | "secondary" | "general";

export type ScoreInput = {
  today: Date;
  country: Country;
  phase: Phase;
  isCitizen: boolean | null;
  qualifications: ReadonlyArray<{ level: string; is_teaching: boolean }>;
  compliance: {
    registration_body: string | null;
    registration_expires_on: string | null;
    needs_permit: boolean | null;
    permit_expires_on: string | null;
    police_clearance: string | null;
    police_clearance_issued_on: string | null;
    child_protection_clear: boolean | null;
    criminal_record: boolean | null;
    dismissed_before: boolean | null;
    safeguarding_concern: boolean | null;
  } | null;
  tenure: TenureSummary;
  answers: ReadonlyArray<{
    competency: string;
    answered: boolean;
    aiBand: number | null;
    humanBand: number | null;
    integrity: "low" | "medium" | "high" | "unchecked";
  }>;
  communication: { aiBand: number | null; humanBand: number | null };
  references: {
    requested: number;
    outstanding: number;
    responses: ReadonlyArray<{
      ratings: Record<string, number>;
      recommendation: "yes" | "with_reservations" | "no";
      wouldReemploy: "yes" | "no" | "not_applicable";
      concern: boolean;
      fromMostRecentEmployer: boolean;
    }>;
  };
  weights: ScoringWeights;
};

export type SectionKey = "qualifications" | "experience" | "answers" | "references" | "communication";

export type Section = {
  key: SectionKey;
  label: string;
  weight: number;
  /** 0 to 1, or null when there is nothing to score yet. */
  fraction: number | null;
  points: number | null;
  notes: string[];
};

export type FlagSeverity = "critical" | "warning" | "info";

export type FlagCode =
  | "safeguarding_reference"
  | "safeguarding_declared"
  | "child_protection_not_clear"
  | "safeguarding_answer_weak"
  | "registration_missing"
  | "permit_expired"
  | "would_not_reemploy"
  | "not_recommended"
  | "no_recent_employer_reference"
  | "possible_ai_answers"
  | "employment_gap"
  | "overlapping_jobs"
  | "references_outstanding";

export type Flag = { code: FlagCode; severity: FlagSeverity; label: string };

export type ScoreResult = {
  /** Points earned, out of `available`. One decimal place. */
  total: number;
  /** The weights of the qualities that could be scored. 100 once everything is in. */
  available: number;
  sections: Section[];
  flags: Flag[];
};

export const SECTION_LABELS: Record<SectionKey, string> = {
  qualifications: "Qualifications and compliance",
  experience: "Experience and stability",
  answers: "Interview answers",
  references: "References",
  communication: "Communication",
};

const RATING_KEYS = ["teaching", "classroom_management", "reliability", "teamwork", "parent_communication", "professionalism"] as const;

function onOrAfter(iso: string | null, today: Date): boolean {
  return !!iso && iso.slice(0, 10) >= today.toISOString().slice(0, 10);
}

function monthsAgo(iso: string, today: Date): number {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return (today.getTime() - d.getTime()) / (30.44 * 86_400_000);
}

function effective(ai: number | null, human: number | null): number | null {
  return human ?? ai;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function scoreApplication(input: ScoreInput): ScoreResult {
  const { today, weights } = input;
  const flags: Flag[] = [];
  const sections: Section[] = [];
  const teaching = input.phase !== "general";
  const expectedBody = input.country === "ZA" ? "SACE" : "BTPC";

  // --- Qualifications and compliance (out of 25 raw) ----------------------
  {
    const notes: string[] = [];
    let raw = 0;
    const hasTeachingQual = input.qualifications.some((q) => q.is_teaching);
    const hasDegree = input.qualifications.some((q) =>
      ["degree", "honours", "postgraduate_certificate", "masters", "doctorate"].includes(q.level)
    );
    if (hasTeachingQual) {
      raw += 10;
      notes.push("Teaching qualification");
    } else if (hasDegree) {
      raw += 5;
      notes.push("A degree, but no teaching qualification");
    } else {
      notes.push(teaching ? "No teaching qualification" : "No degree");
    }

    const c = input.compliance;
    if (c) {
      const registered = c.registration_body === expectedBody && (c.registration_expires_on === null || onOrAfter(c.registration_expires_on, today));
      if (registered) {
        raw += 5;
        notes.push(`Registered with ${expectedBody}`);
      } else if (c.registration_body === "other" || (c.registration_body && c.registration_body !== "none")) {
        raw += 2;
        notes.push(`Registered, but not with ${expectedBody} or the registration has expired`);
      }
      if (teaching && !registered) {
        flags.push({ code: "registration_missing", severity: "warning", label: `No current ${expectedBody} registration` });
      }

      if (c.police_clearance === "have" && c.police_clearance_issued_on && monthsAgo(c.police_clearance_issued_on, today) <= 6) {
        raw += 4;
        notes.push("Police clearance from the last six months");
      } else if (c.police_clearance === "have" || c.police_clearance === "applied") {
        raw += 2;
        notes.push(c.police_clearance === "applied" ? "Police clearance applied for" : "Police clearance older than six months");
      }

      if (c.child_protection_clear === true) raw += 3;
      if (c.child_protection_clear === false) {
        flags.push({ code: "child_protection_not_clear", severity: "critical", label: "Did not declare a clear child-protection record" });
      }
      if (c.criminal_record || c.dismissed_before || c.safeguarding_concern) {
        flags.push({ code: "safeguarding_declared", severity: "critical", label: "Declared a record, a dismissal or a safeguarding matter" });
      }

      const permitOk = input.isCitizen === true || (c.needs_permit === true && onOrAfter(c.permit_expires_on, today)) || c.needs_permit === false;
      if (permitOk) raw += 3;
      if (c.needs_permit === true && !onOrAfter(c.permit_expires_on, today)) {
        flags.push({ code: "permit_expired", severity: "warning", label: "Work permit missing or expired" });
      }
    } else {
      notes.push("Compliance section not completed");
    }
    sections.push(section("qualifications", weights.qualifications, raw / 25, notes));
  }

  // --- Experience and stability (out of 20 raw) ----------------------------
  {
    const notes: string[] = [];
    const t = input.tenure;
    const years = Math.min(10, (teaching ? t.schoolMonths : t.totalMonths) / 12);
    let raw = (12 * years) / 10;
    notes.push(`${Math.floor(years)} year${Math.floor(years) === 1 ? "" : "s"} of ${teaching ? "school" : "relevant"} experience`);
    const avg = t.averageMonths;
    if (avg === null) {
      raw += t.jobs.length ? 4 : 0;
      notes.push(t.jobs.length ? "Only a recent current job" : "No work history");
    } else {
      raw += avg >= 36 ? 8 : avg >= 24 ? 6 : avg >= 12 ? 3 : 0;
      notes.push(`Average time in a job: ${Math.round(avg)} months`);
    }
    if (t.gaps.length) flags.push({ code: "employment_gap", severity: "info", label: `A gap of ${Math.max(...t.gaps.map((g) => g.months))} months between jobs` });
    if (t.overlaps.length) flags.push({ code: "overlapping_jobs", severity: "info", label: "Two jobs overlap in the dates given" });
    sections.push(section("experience", weights.experience, raw / 20, notes));
  }

  // --- Interview answers ---------------------------------------------------
  {
    const answers = input.answers;
    // A blank answer is band 0 without anyone marking it. The section counts
    // only when every answered question has a band.
    const bands = answers.map((a) => (a.answered ? effective(a.aiBand, a.humanBand) : 0));
    const ready = answers.length > 0 && bands.every((b) => b !== null);
    const notes: string[] = [];
    let fraction: number | null = null;
    if (ready) {
      const mean = (bands as number[]).reduce((s, b) => s + b, 0) / bands.length;
      fraction = mean / 4;
      notes.push(`Average band ${round1(mean)} of 4 over ${bands.length} questions`);
    } else if (answers.length) {
      notes.push(`${bands.filter((b) => b !== null).length} of ${answers.length} answers marked`);
    }
    answers.forEach((a, i) => {
      const b = bands[i];
      if (a.competency === "safeguarding" && b !== null && b <= 1) {
        flags.push({ code: "safeguarding_answer_weak", severity: "critical", label: "A weak answer to a safeguarding question" });
      }
    });
    const flagged = answers.filter((a) => a.integrity === "high" || a.integrity === "medium").length;
    if (flagged) {
      flags.push({
        code: "possible_ai_answers",
        severity: "warning",
        label: `Possible AI-written answers: ${flagged} of ${answers.length}`,
      });
    }
    sections.push({ key: "answers", label: SECTION_LABELS.answers, weight: weights.answers, fraction, points: fraction === null ? null : round1(fraction * weights.answers), notes });
  }

  // --- References (out of 15 raw) -------------------------------------------
  {
    const r = input.references;
    const notes: string[] = [];
    let fraction: number | null = null;
    if (r.responses.length) {
      const values = r.responses.flatMap((resp) =>
        RATING_KEYS.map((k) => resp.ratings[k]).filter((v): v is number => typeof v === "number" && v >= 1 && v <= 5)
      );
      const meanRating = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 3;
      const recPoints =
        r.responses.reduce((s, resp) => s + (resp.recommendation === "yes" ? 3 : resp.recommendation === "with_reservations" ? 1 : 0), 0) /
        r.responses.length;
      const raw = ((meanRating - 1) / 4) * 12 + recPoints;
      fraction = raw / 15;
      notes.push(`${r.responses.length} of ${r.requested} references received, average rating ${round1(meanRating)} of 5`);
    } else if (r.requested) {
      notes.push(`Waiting for ${r.requested} reference${r.requested === 1 ? "" : "s"}`);
    }
    if (r.responses.some((x) => x.concern)) {
      flags.push({ code: "safeguarding_reference", severity: "critical", label: "A referee raised a concern" });
    }
    if (r.responses.some((x) => x.wouldReemploy === "no")) {
      flags.push({ code: "would_not_reemploy", severity: "warning", label: "A referee would not employ them again" });
    }
    if (r.responses.some((x) => x.recommendation === "no")) {
      flags.push({ code: "not_recommended", severity: "warning", label: "A referee does not recommend them" });
    }
    if (r.outstanding > 0) {
      flags.push({ code: "references_outstanding", severity: "info", label: `${r.outstanding} reference${r.outstanding === 1 ? "" : "s"} outstanding` });
    } else if (r.requested > 0 && !r.responses.some((x) => x.fromMostRecentEmployer)) {
      flags.push({ code: "no_recent_employer_reference", severity: "warning", label: "No reference from the most recent employer" });
    }
    sections.push({ key: "references", label: SECTION_LABELS.references, weight: weights.references, fraction, points: fraction === null ? null : round1(fraction * weights.references), notes });
  }

  // --- Communication ------------------------------------------------------------
  {
    const band = effective(input.communication.aiBand, input.communication.humanBand);
    const fraction = band === null ? null : band / 4;
    sections.push({
      key: "communication",
      label: SECTION_LABELS.communication,
      weight: weights.communication,
      fraction,
      points: fraction === null ? null : round1(fraction * weights.communication),
      notes: band === null ? ["Not yet marked"] : [`Band ${band} of 4 for clarity and register`],
    });
  }

  const scored = sections.filter((s) => s.points !== null);
  const totalWeight = sections.reduce((s, x) => s + x.weight, 0);
  // Weights are normally 100 in all; if a school sets them otherwise the
  // score is still out of 100.
  const scale = totalWeight > 0 ? 100 / totalWeight : 1;
  return {
    total: round1(scored.reduce((s, x) => s + (x.points ?? 0), 0) * scale),
    available: Math.round(scored.reduce((s, x) => s + x.weight, 0) * scale),
    sections,
    flags: dedupe(flags),
  };
}

function section(key: SectionKey, weight: number, fraction: number, notes: string[]): Section {
  const f = Math.max(0, Math.min(1, fraction));
  return { key, label: SECTION_LABELS[key], weight, fraction: f, points: round1(f * weight), notes };
}

function dedupe(flags: Flag[]): Flag[] {
  const seen = new Set<FlagCode>();
  const order: Record<FlagSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return flags
    .filter((f) => (seen.has(f.code) ? false : (seen.add(f.code), true)))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}
