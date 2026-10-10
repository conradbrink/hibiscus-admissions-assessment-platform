import { describe, expect, it } from "vitest";
import { smsLength } from "@/lib/messaging/sms";

describe("smsLength", () => {
  it("counts plain text as one message up to 160 characters", () => {
    expect(smsLength("a".repeat(160))).toEqual({ units: 160, encoding: "gsm", parts: 1, singleLimit: 160 });
  });
  it("splits plain text into 153-character parts past 160", () => {
    expect(smsLength("a".repeat(161)).parts).toBe(2);
    expect(smsLength("a".repeat(306)).parts).toBe(2);
    expect(smsLength("a".repeat(307)).parts).toBe(3);
  });
  it("counts an extended GSM character as two", () => {
    expect(smsLength("€").units).toBe(2);
    expect(smsLength("a".repeat(159) + "[").parts).toBe(2);
  });
  it("moves the whole message to unicode for one emoji or curly quote", () => {
    const withEmoji = smsLength("See you soon! 🙂");
    expect(withEmoji.encoding).toBe("unicode");
    expect(withEmoji.singleLimit).toBe(70);
    expect(smsLength("your child’s visit").encoding).toBe("unicode");
    expect(smsLength("a".repeat(71) + "’").parts).toBe(2);
  });
  it("keeps a straight apostrophe in plain text", () => {
    expect(smsLength("your child's follow-up campus visit").encoding).toBe("gsm");
  });
  it("has no parts when there is nothing to send", () => {
    expect(smsLength("").parts).toBe(0);
  });
  it("counts the school's thank-you SMS as one message", () => {
    const text = "Hi Neo, thank you for coming to our Bana Tlokweng Open Day. Your child is welcome to book a campus visit at Hibiscus Bana Tlokweng. See you soon!";
    expect(smsLength(text)).toMatchObject({ encoding: "gsm", parts: 1 });
  });
});
