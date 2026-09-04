import { z } from "zod";
import { isPlausibleDateOfBirth } from "@/lib/grades";
import { toSchoolDateString } from "@/lib/format-date";

/**
 * Input schemas shared by the funnel's client forms and server actions. The
 * same rule runs in both places, so a parent sees the problem on the field
 * and the server still refuses it if the browser was bypassed.
 */

const name = z
  .string()
  .trim()
  .min(1, "Required")
  .max(80, "Too long")
  .regex(/^[\p{L}\p{M}'’\-. ]+$/u, "Letters, spaces, hyphens and apostrophes only");

export const enquirySchema = z.object({
  parentFirstName: name,
  parentLastName: name,
  email: z.email("Enter a valid email address").max(200),
  mobile: z
    .string()
    .trim()
    .min(7, "Enter a mobile number we can reach you on")
    .max(25, "Too long")
    .regex(/^[+\d\s\-().]+$/, "Digits only, with an optional + and spaces"),
  childFirstName: name,
  childLastName: name,
  childDateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
    .refine((v) => isPlausibleDateOfBirth(v, toSchoolDateString(new Date())), {
      message: "Check the date of birth",
    }),
  campusId: z.uuid("Choose a campus"),
  intakeId: z.uuid().nullable().optional(),
  currentSchool: z.string().trim().max(120).optional(),
  currentGrade: z.string().trim().max(40).optional(),
  /** Funnel timing: when the parent first saw the form. */
  t0: z.coerce.number().int().nonnegative().optional(),
});

export type EnquiryFormInput = z.infer<typeof enquirySchema>;

export const callbackSchema = enquirySchema.extend({
  preferredTime: z.string().trim().max(80).optional(),
  message: z.string().trim().max(1000).optional(),
});

export const freshLinkSchema = z.object({
  email: z.email("Enter the email address you enquired with"),
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^HBS-\d{4}-\d{5}$/, "A reference looks like HBS-2026-00482"),
});

/** Flattens zod issues into { field: message } for a form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
