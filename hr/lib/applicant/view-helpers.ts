import { SECTIONS, type Section } from "@/lib/applicant/schemas";

/** How long each section usually takes, shown beside it so the long one is expected. */
export const SECTION_MINUTES: Record<Section, string> = {
  personal: "1 minute",
  qualifications: "3 minutes",
  career: "5 minutes",
  compliance: "3 minutes",
  documents: "2 minutes",
  questions: "20 to 30 minutes",
  references: "3 minutes",
};

export function nextSection(done: readonly string[]): Section | null {
  return SECTIONS.find((s) => !done.includes(s)) ?? null;
}
