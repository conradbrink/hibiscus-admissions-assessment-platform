import { describe, expect, it } from "vitest";
import { autoReplyFor, AUTO_REPLY_COOLDOWN_HOURS, fillIn, type AutoReplyInputs } from "@/lib/messaging/auto-reply";

const TEMPLATE =
  "Thank you for your message. This number only sends updates and nobody reads replies to it. " +
  "To talk to us please message {{whatsapp}} on WhatsApp{{#phone}} or call {{phone}}{{/phone}}.";

const base: AutoReplyInputs = {
  enabled: true,
  template: TEMPLATE,
  whatsapp: "+267 72 320 145",
  phone: "+267 392 4299",
  isConsentCommand: false,
  lastRepliedAt: null,
  now: new Date("2026-09-21T09:00:00Z"),
};

describe("whether to answer at all", () => {
  it("answers a parent who has written in", () => {
    const d = autoReplyFor(base);
    expect(d.send).toBe(true);
    if (d.send) {
      expect(d.text).toContain("+267 72 320 145");
      expect(d.text).toContain("+267 392 4299");
      expect(d.text).not.toContain("{{");
    }
  });

  it("stays quiet when the school has switched it off", () => {
    expect(autoReplyFor({ ...base, enabled: false })).toEqual({
      send: false,
      reason: "the automatic reply is switched off",
    });
  });

  it("does not answer STOP or START", () => {
    // Consent is answered by acting on it. Replying to STOP with a message is
    // exactly what a parent who just said stop does not want.
    const d = autoReplyFor({ ...base, isConsentCommand: true });
    expect(d.send).toBe(false);
  });

  it("says nothing when there is no manned number to send them to", () => {
    // Better silence than "please message " with a hole where the number goes.
    const d = autoReplyFor({ ...base, whatsapp: null });
    expect(d).toEqual({ send: false, reason: "no manned number is set for this campus" });
  });

  it("refuses an empty wording rather than sending a blank message", () => {
    expect(autoReplyFor({ ...base, template: "   " }).send).toBe(false);
  });
});

describe("not twice in a morning", () => {
  it("holds off inside the cooldown", () => {
    const d = autoReplyFor({ ...base, lastRepliedAt: new Date("2026-09-21T06:00:00Z") });
    expect(d.send).toBe(false);
    if (!d.send) expect(d.reason).toContain("3h ago");
  });

  it("answers again once the cooldown has passed", () => {
    const past = new Date(base.now.getTime() - (AUTO_REPLY_COOLDOWN_HOURS + 1) * 3_600_000);
    expect(autoReplyFor({ ...base, lastRepliedAt: past }).send).toBe(true);
  });

  it("treats the boundary as still inside", () => {
    const exactly = new Date(base.now.getTime() - AUTO_REPLY_COOLDOWN_HOURS * 3_600_000 + 1000);
    expect(autoReplyFor({ ...base, lastRepliedAt: exactly }).send).toBe(false);
  });
});

describe("the wording", () => {
  it("drops the phone clause whole when there is no phone number", () => {
    const text = fillIn(TEMPLATE, "+27 61 097 5213", null);
    expect(text).toContain("+27 61 097 5213");
    expect(text).not.toContain("or call");
    expect(text).not.toContain("{{");
    // And it still reads as a sentence.
    expect(text.endsWith("on WhatsApp.")).toBe(true);
  });

  it("keeps the phone clause when there is one", () => {
    expect(fillIn(TEMPLATE, "+267 72 320 145", "+267 392 4299")).toContain("or call +267 392 4299");
  });

  it("puts the same number in every place it is named", () => {
    expect(fillIn("{{whatsapp}} — really, {{whatsapp}}", "+267 1", null)).toBe("+267 1 — really, +267 1");
  });
});
