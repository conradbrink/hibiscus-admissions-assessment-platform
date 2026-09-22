import { describe, expect, it } from "vitest";
import { accountIsBlocked, classifyFailure, summariseFailures } from "@/lib/messaging/failure-kind";

// The four errors below are the real ones from production, copied exactly as
// they are stored. They are the reason this file exists.
const TEMPLATE_MISSING = "WhatsApp: (#132001) Template name does not exist in the translation";
const PARAMS_MISMATCH = "WhatsApp: (#132000) Number of parameters does not match the expected number of params";
const UNDELIVERABLE = "Message undeliverable - Message Undeliverable.";
const PACING =
  "This message was not delivered to maintain healthy ecosystem engagement. - In order to maintain a healthy ecosystem engagement, the message failed to be delivered.";

describe("classifyFailure", () => {
  it("blames the template when Meta has never heard of it", () => {
    expect(classifyFailure(TEMPLATE_MISSING)).toBe("template");
  });

  it("blames the template when the variable count is wrong", () => {
    expect(classifyFailure(PARAMS_MISMATCH)).toBe("template");
  });

  it("blames the number when it cannot receive WhatsApp", () => {
    expect(classifyFailure(UNDELIVERABLE)).toBe("recipient");
  });

  it("blames the number when Meta is pacing it, though no code is sent", () => {
    expect(classifyFailure(PACING)).toBe("recipient");
  });

  it("blames the account when the sender is rate limited", () => {
    expect(classifyFailure("WhatsApp: (#130429) Rate limit hit")).toBe("account");
  });

  it("treats an error it has never seen as the template's, so it is never hidden", () => {
    expect(classifyFailure("something nobody has taught this function about")).toBe("template");
    expect(classifyFailure(null)).toBe("template");
    expect(classifyFailure("")).toBe("template");
  });

  it("reads the code in preference to the words around it", () => {
    // Meta's own wording for #131047 mentions the template; the code decides.
    expect(classifyFailure("WhatsApp: (#131047) Template send failed, re-engagement message")).toBe("recipient");
  });
});

describe("summariseFailures", () => {
  it("keeps one parent's unreachable number off the template's record", () => {
    const rows = [
      { template_key: "playdate_confirmed", error: UNDELIVERABLE, to_normalised: "+26772428349" },
      { template_key: "payment_received", error: UNDELIVERABLE, to_normalised: "+26772428349" },
    ];
    const summary = summariseFailures(rows);
    expect(summary.get("playdate_confirmed")!.template.count).toBe(0);
    expect(summary.get("playdate_confirmed")!.recipient.count).toBe(1);
    expect(summary.get("payment_received")!.template.count).toBe(0);
  });

  it("counts the distinct numbers behind a template's recipient failures", () => {
    const rows = [
      { template_key: "preschool_offer", error: UNDELIVERABLE, to_normalised: "+26772428349" },
      { template_key: "preschool_offer", error: UNDELIVERABLE, to_normalised: "+26772428349" },
      { template_key: "preschool_offer", error: PACING, to_normalised: "+26771602738" },
    ];
    const summary = summariseFailures(rows).get("preschool_offer")!;
    expect(summary.recipient.count).toBe(3);
    expect(summary.recipient.numbers).toBe(2);
    expect(summary.template.count).toBe(0);
  });

  it("still reports a genuinely broken template", () => {
    const rows = Array.from({ length: 12 }, () => ({ template_key: "enquiry_received", error: TEMPLATE_MISSING, to_normalised: "+2677000000" }));
    const summary = summariseFailures(rows).get("enquiry_received")!;
    expect(summary.template.count).toBe(12);
    expect(summary.template.error).toBe(TEMPLATE_MISSING);
    expect(summary.recipient.count).toBe(0);
  });

  it("separates the two kinds on one template", () => {
    const summary = summariseFailures([
      { template_key: "preschool_enquiry_received", error: UNDELIVERABLE, to_normalised: "+26772428349" },
      { template_key: "preschool_enquiry_received", error: PARAMS_MISMATCH, to_normalised: "+26771111111" },
    ]).get("preschool_enquiry_received")!;
    expect(summary.template.count).toBe(1);
    expect(summary.template.error).toBe(PARAMS_MISMATCH);
    expect(summary.recipient.count).toBe(1);
  });

  it("keeps the newest error, given newest-first rows", () => {
    const summary = summariseFailures([
      { template_key: "enquiry_received", error: TEMPLATE_MISSING },
      { template_key: "enquiry_received", error: PARAMS_MISMATCH },
    ]).get("enquiry_received")!;
    expect(summary.template.error).toBe(TEMPLATE_MISSING);
  });

  it("ignores an inbound reply, which has no template and cannot fail to send", () => {
    expect(summariseFailures([{ template_key: null, error: UNDELIVERABLE }]).size).toBe(0);
  });

  it("counts a recipient failure with no number recorded, without inventing one", () => {
    const summary = summariseFailures([{ template_key: "offer_reminder", error: UNDELIVERABLE, to_normalised: null }]).get("offer_reminder")!;
    expect(summary.recipient.count).toBe(1);
    expect(summary.recipient.numbers).toBe(0);
  });
});

describe("accountIsBlocked", () => {
  it("is quiet when nothing is wrong with the sender", () => {
    expect(accountIsBlocked([{ template_key: "a", error: UNDELIVERABLE }]).blocked).toBe(false);
    expect(accountIsBlocked([{ template_key: "a", error: TEMPLATE_MISSING }]).blocked).toBe(false);
  });

  it("speaks up when the sender itself is stopped, and says what Meta said", () => {
    const result = accountIsBlocked([
      { template_key: "a", error: UNDELIVERABLE },
      { template_key: "b", error: "WhatsApp: (#131031) Account locked" },
    ]);
    expect(result.blocked).toBe(true);
    expect(result.error).toBe("WhatsApp: (#131031) Account locked");
  });
});
