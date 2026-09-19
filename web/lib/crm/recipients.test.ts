import { describe, expect, it } from "vitest";
import { EXCLUSION_LABELS, exclusionFor, isTransactional, planRecipients, type RecipientContact } from "@/lib/crm/recipients";

function contact(over: Partial<RecipientContact> = {}): RecipientContact {
  return {
    id: "p1",
    family_id: "f1",
    first_name: "Anna",
    last_name: "Brink",
    email: "anna@example.com",
    mobile_normalised: "+26771234567",
    whatsapp_opt_in: true,
    marketing_email_consent: true,
    marketing_whatsapp_consent: true,
    unsubscribed_at: null,
    is_active: true,
    is_primary: true,
    ...over,
  };
}

describe("exclusionFor", () => {
  it("lets a consenting primary contact through on both channels", () => {
    expect(exclusionFor(contact(), "email", false, false)).toBeNull();
    expect(exclusionFor(contact(), "whatsapp", false, false)).toBeNull();
  });
  it("marketing needs consent, and an unsubscribe wins over consent", () => {
    expect(exclusionFor(contact({ marketing_email_consent: false }), "email", false, false)).toBe("no_consent_email");
    expect(exclusionFor(contact({ unsubscribed_at: "2026-01-01T00:00:00Z" }), "email", false, false)).toBe("unsubscribed");
    expect(exclusionFor(contact({ marketing_whatsapp_consent: false }), "whatsapp", false, false)).toBe("no_consent_whatsapp");
  });
  it("a transactional notice does not need marketing consent, but still needs WhatsApp updates on", () => {
    expect(exclusionFor(contact({ marketing_email_consent: false, unsubscribed_at: "2026-01-01T00:00:00Z" }), "email", true, false)).toBeNull();
    expect(exclusionFor(contact({ marketing_whatsapp_consent: false }), "whatsapp", true, false)).toBeNull();
    expect(exclusionFor(contact({ whatsapp_opt_in: false }), "whatsapp", true, false)).toBe("whatsapp_updates_off");
  });
  it("needs a usable address or number", () => {
    expect(exclusionFor(contact({ email: null }), "email", true, false)).toBe("invalid_email");
    expect(exclusionFor(contact({ email: "not an email" }), "email", true, false)).toBe("invalid_email");
    expect(exclusionFor(contact({ mobile_normalised: null }), "whatsapp", true, false)).toBe("invalid_number");
    expect(exclusionFor(contact({ mobile_normalised: "71234567" }), "whatsapp", true, false)).toBe("invalid_number");
  });
  it("skips inactive contacts and, unless asked, non-primary ones", () => {
    expect(exclusionFor(contact({ is_active: false }), "email", true, true)).toBe("contact_inactive");
    expect(exclusionFor(contact({ is_primary: false }), "email", true, false)).toBe("not_primary");
    expect(exclusionFor(contact({ is_primary: false }), "email", true, true)).toBeNull();
  });
});

describe("planRecipients", () => {
  it("counts recipients, families and every exclusion by reason", () => {
    const plan = planRecipients(
      [
        contact(),
        contact({ id: "p2", family_id: "f2", marketing_email_consent: false }),
        contact({ id: "p3", family_id: "f2", is_primary: false }),
        contact({ id: "p4", family_id: "f3", email: null, mobile_normalised: null }),
      ],
      { channel: "both", category: "promotion" }
    );
    expect(plan.email).toBe(1);
    expect(plan.whatsapp).toBe(2);
    expect(plan.familiesReached).toBe(2);
    expect(plan.exclusionCounts).toEqual({ no_consent_email: 1, not_primary: 2, invalid_email: 1, invalid_number: 1 });
    expect(plan.recipients.map((r) => `${r.contactId}:${r.channel}`).sort()).toEqual(["p1:email", "p1:whatsapp", "p2:whatsapp"]);
  });
  it("a single-channel campaign plans only that channel", () => {
    const plan = planRecipients([contact()], { channel: "email", category: "general" });
    expect(plan.recipients).toEqual([{ contactId: "p1", familyId: "f1", channel: "email" }]);
    expect(plan.excluded).toEqual([]);
  });
  it("knows which categories are transactional", () => {
    expect(isTransactional("fee_notice")).toBe(true);
    expect(isTransactional("reenrolment")).toBe(true);
    expect(isTransactional("promotion")).toBe(false);
    expect(isTransactional("general")).toBe(false);
  });
  it("has words for every reason", () => {
    for (const k of ["no_consent_email", "no_consent_whatsapp", "unsubscribed", "whatsapp_updates_off", "invalid_email", "invalid_number", "contact_inactive", "not_primary"] as const) {
      expect(EXCLUSION_LABELS[k]).toBeTruthy();
    }
  });
});
