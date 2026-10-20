import { describe, expect, it } from "vitest";
import { bookingErrorMessage, isKnownBookingError } from "@/lib/transport/errors";
import { bookingRpcArgs, parseTransportBooking } from "@/lib/transport/form";
import { daysCount, weekdaysLabel } from "@/lib/transport/days";

const PERIOD = "11111111-1111-4111-8111-111111111111";
const AREA = "22222222-2222-4222-8222-222222222222";
const TERMS = "33333333-3333-4333-8333-333333333333";
const BH = "44444444-4444-4444-8444-444444444444";
const B7 = "55555555-5555-4555-8555-555555555555";
const STAGE4 = "66666666-6666-4666-8666-666666666666";
const HASH = "a".repeat(64);

function form(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    period_id: PERIOD,
    area_id: AREA,
    terms_id: TERMS,
    terms_hash: HASH,
    accept_terms: "1",
    parent_first_name: "Neo",
    parent_last_name: "Kgosi",
    email: " Neo.Kgosi@Example.com ",
    mobile: "+26771234567",
    address_line: "Plot 1234, Block 8",
    children: "2",
    child_1_first_name: "Kago",
    child_1_last_name: "Kgosi",
    child_1_campus_id: BH,
    child_1_grade_id: STAGE4,
    child_1_service: "full",
    child_1_mon: "1",
    child_1_tue: "1",
    child_1_wed: "1",
    child_1_thu: "1",
    child_1_fri: "1",
    child_2_first_name: "Lesedi",
    child_2_last_name: "Kgosi",
    child_2_campus_id: B7,
    child_2_grade_id: STAGE4,
    child_2_service: "pm",
    child_2_mon: "1",
    child_2_wed: "1",
    child_2_fri: "1",
    ...overrides,
  };
}

describe("parseTransportBooking", () => {
  it("reads a parent and two children", () => {
    const result = parseTransportBooking(form());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.emailNormalised).toBe("neo.kgosi@example.com");
    expect(result.value.children).toHaveLength(2);
    expect(result.value.children[1].service).toBe("pm");
    expect(daysCount(result.value.children[1].days)).toBe(3);
    expect(result.value.secondContactName).toBeNull();
  });

  it("reads only the number of children the page said it showed", () => {
    const result = parseTransportBooking(form({ children: "1" }));
    expect(result.ok && result.value.children).toHaveLength(1);
  });

  it("names the field that is wrong, per child", () => {
    const result = parseTransportBooking(form({ child_2_campus_id: "", child_2_mon: "", child_2_wed: "", child_2_fri: "" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fields.child_2_campus_id).toBe("Choose a school");
    expect(result.fields.child_2_days).toBe("Choose at least one day");
    expect(result.fields.child_1_campus_id).toBeUndefined();
  });

  it("needs the terms ticked", () => {
    const result = parseTransportBooking(form({ accept_terms: "" }));
    expect(!result.ok && result.fields.accept_terms).toMatch(/transport terms/);
  });

  it("refuses more than six children", () => {
    const result = parseTransportBooking(form({ children: "7" }));
    expect(result.ok).toBe(false);
  });

  it("has no field for a price, so cannot carry one to the database", () => {
    const result = parseTransportBooking(form({ amount_minor: "1", child_1_amount_minor: "1" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const args = bookingRpcArgs(result.value, { ipHash: "h", userAgent: "ua" });
    expect(JSON.stringify(args)).not.toMatch(/amount/);
    expect(args.p_riders[0]).toMatchObject({ campus_id: BH, mon: true, fri: true, service: "full" });
    expect(args.p_booking).toMatchObject({ email_normalised: "neo.kgosi@example.com", ip_hash: "h" });
  });
});

describe("weekdaysLabel", () => {
  const set = (on: string[]) => ({ mon: on.includes("mon"), tue: on.includes("tue"), wed: on.includes("wed"), thu: on.includes("thu"), fri: on.includes("fri") });
  it("reads a run as a range and anything else as a list", () => {
    expect(weekdaysLabel(set(["mon", "tue", "wed", "thu", "fri"]))).toBe("Monday to Friday");
    expect(weekdaysLabel(set(["mon", "tue", "wed"]))).toBe("Monday to Wednesday");
    expect(weekdaysLabel(set(["mon", "wed", "fri"]))).toBe("Monday, Wednesday and Friday");
    expect(weekdaysLabel(set(["mon", "tue"]))).toBe("Monday and Tuesday");
    expect(weekdaysLabel(set(["thu"]))).toBe("Thursday");
  });
});

describe("bookingErrorMessage", () => {
  it("turns a database code into a sentence", () => {
    expect(bookingErrorMessage("transport_period_not_open")).toMatch(/closed/);
    expect(isKnownBookingError("transport_terms_changed")).toBe(true);
  });

  it("never shows a parent a raw error", () => {
    expect(bookingErrorMessage('duplicate key value violates unique constraint "x"')).toMatch(/could not take this booking/);
    expect(isKnownBookingError("something else")).toBe(false);
    expect(bookingErrorMessage(null)).toMatch(/could not take this booking/);
  });
});
