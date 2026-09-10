import { z } from "zod";
import { HEARD_FROM_KEYS } from "@/lib/heard-from";
import { checkStoredMobile } from "@/lib/phone";
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

/**
 * A mobile number, in the one form WhatsApp accepts. The field asks for the
 * country and the number separately and submits them joined; this refuses
 * anything else, so a browser that skipped the field cannot store a number
 * the school will not be able to message.
 */
export const mobileNumber = z
  .string()
  .trim()
  .min(1, "Enter a mobile number we can reach you on")
  .max(25, "Too long")
  .superRefine((value, ctx) => {
    const checked = checkStoredMobile(value);
    if (!checked.ok) ctx.addIssue({ code: "custom", message: checked.reason });
  })
  .transform((value) => {
    const checked = checkStoredMobile(value);
    return checked.ok ? checked.e164 : value;
  });

/** The same rule where a number is welcome but not required. */
export const optionalMobileNumber = z
  .string()
  .trim()
  .max(25, "Too long")
  .optional()
  .superRefine((value, ctx) => {
    if (!value) return;
    const checked = checkStoredMobile(value);
    if (!checked.ok) ctx.addIssue({ code: "custom", message: checked.reason });
  })
  .transform((value) => {
    if (!value) return null;
    const checked = checkStoredMobile(value);
    return checked.ok ? checked.e164 : value;
  });

export const enquirySchema = z.object({
  parentFirstName: name,
  parentLastName: name,
  email: z.email("Enter a valid email address").max(200),
  mobile: mobileNumber,
  childFirstName: name,
  childLastName: name,
  childDateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
    .refine((v) => isPlausibleDateOfBirth(v, toSchoolDateString(new Date())), {
      message: "Check the date of birth",
    }),
  campusId: z.guid("Choose a campus"),
  intakeId: z.guid().nullable().optional(),
  currentSchool: z.string().trim().max(120).optional(),
  currentGrade: z.string().trim().max(40).optional(),
  /** "Send updates on WhatsApp too": ticked by default beside a plain notice, and unticked in one tap. */
  whatsappOptIn: z.literal("1").optional(),
  /**
   * Additional needs, asked so the sitting can be arranged around the child.
   * Never an input to a decision — see `applications.has_special_needs`.
   */
  hasSpecialNeeds: z.literal("1").optional(),
  specialNeedsDetail: z.string().trim().max(600, "Too long").optional(),
  /** "How did you hear about us?" — for the school's advertising, one pick from a fixed list. */
  heardFrom: z.enum(HEARD_FROM_KEYS, { error: "Choose one" }),
  heardFromDetail: z.string().trim().max(120, "Too long").optional(),
  /** A promotion code from an advert, optional; checked against live deals in the action. */
  promoCode: z.string().trim().max(24, "Too long").optional(),
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
