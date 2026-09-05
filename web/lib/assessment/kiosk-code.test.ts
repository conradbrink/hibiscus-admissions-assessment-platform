import { describe, expect, it } from "vitest";
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  decodeKioskSession,
  encodeKioskSession,
  generateKioskCode,
  hashKioskCode,
  isWellFormedKioskCode,
  normaliseKioskCode,
} from "@/lib/assessment/kiosk-code";
import { decodeParentSession, encodeParentSession } from "@/lib/tokens/session";

const SECRET = "test-secret-that-is-long-enough";

describe("kiosk codes", () => {
  it("generates well-formed codes from the safe alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateKioskCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isWellFormedKioskCode(code)).toBe(true);
      expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    }
  });

  it("normalises what a person types", () => {
    expect(normaliseKioskCode(" abc-d2 3 ")).toBe("ABCD23");
    // 0 and 1 are not in the alphabet; a typed 0 means O and 1 means I.
    expect(normaliseKioskCode("0o1i22")).toBe("OOII22");
    expect(isWellFormedKioskCode(normaliseKioskCode("abcd23"))).toBe(true);
    expect(isWellFormedKioskCode("ABCD2")).toBe(false);
  });

  it("hashes with a domain, so a code hash is never a token hash", () => {
    const h = hashKioskCode("ABCD23");
    expect(h).not.toBe(hashKioskCode("ABCD24"));
    expect(h).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("kiosk session cookie", () => {
  const session = { attemptId: "att-1", issuedAt: 1_000, expiresAt: 2_000 };

  it("round-trips and expires", () => {
    const value = encodeKioskSession(session, SECRET);
    expect(decodeKioskSession(value, SECRET, 1_500)).toEqual(session);
    expect(decodeKioskSession(value, SECRET, 2_000)).toBeNull();
  });

  it("rejects tampering and the wrong secret", () => {
    const value = encodeKioskSession(session, SECRET);
    const [payload, sig] = value.split(".");
    expect(decodeKioskSession(`${payload}x.${sig}`, SECRET, 1_500)).toBeNull();
    expect(decodeKioskSession(value, "another-secret", 1_500)).toBeNull();
    expect(decodeKioskSession("garbage", SECRET, 1_500)).toBeNull();
  });

  it("is not interchangeable with a parent session signed by the same secret", () => {
    const parent = encodeParentSession(
      { applicationId: "att-1", purpose: "next_step", issuedAt: 1_000, expiresAt: 2_000 },
      SECRET
    );
    expect(decodeKioskSession(parent, SECRET, 1_500)).toBeNull();
    const kiosk = encodeKioskSession(session, SECRET);
    expect(decodeParentSession(kiosk, SECRET, 1_500)).toBeNull();
  });
});
