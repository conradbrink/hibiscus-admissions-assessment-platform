import { z } from "zod";
import { normaliseEmail } from "@/lib/contacts";
import { WEEKDAYS, type WeekdaySet } from "@/lib/transport/days";
import { mobileNumber, optionalMobileNumber, personName } from "@/lib/validation";

/**
 * The transport booking form, read on the server.
 *
 * The form posts one set of fields for the parent and one per child, named
 * `child_1_first_name`, `child_2_campus_id` and so on, with `children` saying
 * how many child blocks were on the page. Every field is checked here and
 * again by `create_transport_booking()`, which owns the parts a browser could
 * lie about (whether the period is open, whether the school teaches the
 * grade); this owns the shape and the words a parent sees beside a field.
 *
 * No price is read from the form. There is no field for one.
 */

export const MAX_CHILDREN = 6;

export type TransportChildInput = {
  firstName: string;
  lastName: string;
  campusId: string;
  gradeId: string;
  service: "full" | "am" | "pm";
  days: WeekdaySet;
  notes: string | null;
};

export type TransportBookingInput = {
  periodId: string;
  areaId: string;
  termsId: string;
  termsHash: string;
  parentFirstName: string;
  parentLastName: string;
  email: string;
  emailNormalised: string;
  mobile: string;
  secondContactName: string | null;
  secondContactMobile: string | null;
  addressLine: string;
  landmark: string | null;
  notes: string | null;
  children: TransportChildInput[];
};

export type ParseResult = { ok: true; value: TransportBookingInput } | { ok: false; fields: Record<string, string> };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, "Too long")
    .optional()
    .transform((v) => (v ? v : null));

const bookingSchema = z.object({
  period_id: z.guid("Choose a term or month"),
  area_id: z.guid("Choose the area you live in"),
  terms_id: z.guid("The terms did not load. Please reload the page."),
  terms_hash: z.string().regex(/^[0-9a-f]{64}$/, "The terms did not load. Please reload the page."),
  accept_terms: z.literal("1", { error: "Tick the box to agree to the transport terms" }),
  parent_first_name: personName,
  parent_last_name: personName,
  // Trimmed before it is checked: a phone keyboard often adds a space after
  // an address, and refusing it would read as "your email is wrong".
  email: z.string().trim().pipe(z.email("Enter a valid email address").max(200)),
  mobile: mobileNumber,
  second_contact_name: optionalText(120),
  second_contact_mobile: optionalMobileNumber,
  address_line: z.string().trim().min(1, "Enter your street or plot").max(300, "Too long"),
  landmark: optionalText(300),
  notes: optionalText(1000),
  children: z.coerce.number().int().min(1).max(MAX_CHILDREN),
});

const childSchema = z.object({
  first_name: personName,
  last_name: personName,
  campus_id: z.guid("Choose a school"),
  grade_id: z.guid("Choose a grade"),
  service: z.enum(["full", "am", "pm"], { error: "Choose morning, afternoon or both" }),
  notes: optionalText(500),
});

function firstIssues(error: z.ZodError, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = `${prefix}${String(issue.path[0] ?? "_")}`;
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function parseTransportBooking(values: Record<string, string>): ParseResult {
  const fields: Record<string, string> = {};
  const booking = bookingSchema.safeParse(values);
  if (!booking.success) Object.assign(fields, firstIssues(booking.error));

  const count = booking.success ? booking.data.children : Math.min(Math.max(Number(values.children) || 1, 1), MAX_CHILDREN);
  const children: TransportChildInput[] = [];
  for (let n = 1; n <= count; n++) {
    const prefix = `child_${n}_`;
    const own: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (k.startsWith(prefix)) own[k.slice(prefix.length)] = v;
    const child = childSchema.safeParse(own);
    const days = Object.fromEntries(WEEKDAYS.map((d) => [d, own[d] === "1"])) as WeekdaySet;
    if (!WEEKDAYS.some((d) => days[d])) fields[`${prefix}days`] = "Choose at least one day";
    if (!child.success) {
      Object.assign(fields, firstIssues(child.error, prefix));
      continue;
    }
    children.push({
      firstName: child.data.first_name,
      lastName: child.data.last_name,
      campusId: child.data.campus_id,
      gradeId: child.data.grade_id,
      service: child.data.service,
      days,
      notes: child.data.notes,
    });
  }

  if (!booking.success || Object.keys(fields).length > 0) return { ok: false, fields };
  const b = booking.data;
  return {
    ok: true,
    value: {
      periodId: b.period_id,
      areaId: b.area_id,
      termsId: b.terms_id,
      termsHash: b.terms_hash,
      parentFirstName: b.parent_first_name,
      parentLastName: b.parent_last_name,
      email: b.email,
      emailNormalised: normaliseEmail(b.email),
      mobile: b.mobile,
      secondContactName: b.second_contact_name,
      secondContactMobile: b.second_contact_mobile,
      addressLine: b.address_line,
      landmark: b.landmark,
      notes: b.notes,
      children,
    },
  };
}

/** The two arguments `create_transport_booking()` takes, in its own key names. */
export function bookingRpcArgs(input: TransportBookingInput, context: { ipHash: string | null; userAgent: string | null }) {
  return {
    p_booking: {
      period_id: input.periodId,
      area_id: input.areaId,
      terms_id: input.termsId,
      terms_hash: input.termsHash,
      parent_first_name: input.parentFirstName,
      parent_last_name: input.parentLastName,
      email: input.email,
      email_normalised: input.emailNormalised,
      mobile: input.mobile,
      second_contact_name: input.secondContactName,
      second_contact_mobile: input.secondContactMobile,
      address_line: input.addressLine,
      landmark: input.landmark,
      notes: input.notes,
      ip_hash: context.ipHash,
      user_agent: context.userAgent,
    },
    p_riders: input.children.map((c) => ({
      first_name: c.firstName,
      last_name: c.lastName,
      grade_id: c.gradeId,
      campus_id: c.campusId,
      service: c.service,
      ...c.days,
      notes: c.notes,
    })),
  };
}
