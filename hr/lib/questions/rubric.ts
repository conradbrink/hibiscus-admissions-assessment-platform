import { z } from "zod";
import type { Json } from "@/lib/supabase/types";

/**
 * A question's rubric: five bands, 0 to 4, each with a descriptor of what an
 * answer at that band shows. The same shape in the bank, on a vacancy and in
 * an AI draft. Pure.
 */
export const BandSchema = z.object({
  band: z.number().int().min(0).max(4),
  descriptor: z.string().min(1).max(600),
});

export const RubricSchema = z.object({ bands: z.array(BandSchema).length(5) });

export type Rubric = z.infer<typeof RubricSchema>;

export function parseRubric(value: Json | null | undefined): Rubric | null {
  const parsed = RubricSchema.safeParse(value);
  if (!parsed.success) return null;
  const bands = [...parsed.data.bands].sort((a, b) => a.band - b.band);
  if (bands.some((b, i) => b.band !== i)) return null;
  return { bands };
}

export const BAND_LABELS = ["No answer", "Weak", "Adequate", "Good", "Excellent"] as const;

export const COMPETENCY_LABELS: Record<string, string> = {
  safeguarding: "Safeguarding",
  pedagogy: "Teaching and learning",
  classroom_management: "Classroom management",
  inclusion: "Inclusion",
  communication: "Communication",
  professionalism: "Professionalism",
  subject_knowledge: "Subject knowledge",
  early_years_practice: "Early years practice",
  assessment: "Assessment",
  teamwork: "Teamwork",
};

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}
