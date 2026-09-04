import { describe, expect, it } from "vitest";
import { decodeParentSession, encodeParentSession, type ParentSession } from "@/lib/tokens/session";

const SECRET = "test-secret-please-do-not-use";
const session: ParentSession = {
  applicationId: "5f1e5b7a-1c1a-4b0e-9c1e-1a2b3c4d5e6f",
  purpose: "next_step",
  issuedAt: 1_000_000,
  expiresAt: 2_000_000,
};

describe("parent session cookie", () => {
  it("round-trips", () => {
    const encoded = encodeParentSession(session, SECRET);
    expect(decodeParentSession(encoded, SECRET, 1_500_000)).toEqual(session);
  });
  it("rejects an expired session", () => {
    const encoded = encodeParentSession(session, SECRET);
    expect(decodeParentSession(encoded, SECRET, 2_000_000)).toBeNull();
    expect(decodeParentSession(encoded, SECRET, 2_000_001)).toBeNull();
  });
  it("rejects a tampered payload", () => {
    const encoded = encodeParentSession(session, SECRET);
    const [payload, sig] = encoded.split(".");
    const other = Buffer.from(
      JSON.stringify({ a: "another-application", p: "next_step", i: 1, e: 9_999_999 })
    ).toString("base64url");
    expect(decodeParentSession(`${other}.${sig}`, SECRET, 1_500_000)).toBeNull();
    expect(decodeParentSession(`${payload}.${sig}x`, SECRET, 1_500_000)).toBeNull();
  });
  it("rejects a session signed with a previous secret", () => {
    const encoded = encodeParentSession(session, "old-secret");
    expect(decodeParentSession(encoded, SECRET, 1_500_000)).toBeNull();
  });
  it("rejects garbage without throwing", () => {
    expect(decodeParentSession("", SECRET)).toBeNull();
    expect(decodeParentSession("no-dot", SECRET)).toBeNull();
    expect(decodeParentSession(".", SECRET)).toBeNull();
    expect(decodeParentSession("a.b", SECRET)).toBeNull();
    expect(decodeParentSession(undefined, SECRET)).toBeNull();
  });
});
