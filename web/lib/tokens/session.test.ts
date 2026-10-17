import { describe, expect, it } from "vitest";
import {
  decodeFamilySession,
  decodeParentSession,
  decodeTransportSession,
  encodeFamilySession,
  encodeParentSession,
  encodeTransportSession,
  type FamilySession,
  type ParentSession,
  type TransportSession,
} from "@/lib/tokens/session";

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

const familySession: FamilySession = {
  familyId: "b2c3d4e5-6f70-4a1b-8c2d-3e4f5a6b7c8d",
  purpose: "family",
  issuedAt: 1_000_000,
  expiresAt: 2_000_000,
};

describe("family session cookie", () => {
  it("round-trips", () => {
    const encoded = encodeFamilySession(familySession, SECRET);
    expect(decodeFamilySession(encoded, SECRET, 1_500_000)).toEqual(familySession);
  });

  it("rejects an expired session", () => {
    const encoded = encodeFamilySession(familySession, SECRET);
    expect(decodeFamilySession(encoded, SECRET, 2_000_000)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const encoded = encodeFamilySession(familySession, SECRET);
    const [payload, sig] = encoded.split(".");
    const other = Buffer.from(
      JSON.stringify({ f: "another-family", p: "family", i: 1, e: 9_999_999 })
    ).toString("base64url");
    expect(decodeFamilySession(`${other}.${sig}`, SECRET, 1_500_000)).toBeNull();
    expect(decodeFamilySession(`${payload}.${sig}x`, SECRET, 1_500_000)).toBeNull();
  });

  it("rejects a session signed with a previous secret", () => {
    expect(decodeFamilySession(encodeFamilySession(familySession, "old-secret"), SECRET, 1_500_000)).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    expect(decodeFamilySession("", SECRET)).toBeNull();
    expect(decodeFamilySession("no-dot", SECRET)).toBeNull();
    expect(decodeFamilySession("a.b", SECRET)).toBeNull();
    expect(decodeFamilySession(undefined, SECRET)).toBeNull();
  });
});

describe("the two cookies cannot be swapped", () => {
  // This is the whole reason they are signed under different domains. A
  // family cookie reaches every child; an application cookie reaches one
  // child's funnel. Neither decoder may ever accept the other's value, even
  // though both are HMACs of a JSON payload made with the same secret.
  it("refuses a family cookie presented as a parent cookie", () => {
    const familyCookie = encodeFamilySession(familySession, SECRET);
    expect(decodeParentSession(familyCookie, SECRET, 1_500_000)).toBeNull();
  });

  it("refuses a parent cookie presented as a family cookie", () => {
    const parentCookie = encodeParentSession(session, SECRET);
    expect(decodeFamilySession(parentCookie, SECRET, 1_500_000)).toBeNull();
  });

  it("refuses a family payload re-signed under the parent domain", () => {
    // Not just a different payload shape: the signature itself must not
    // verify, so lifting one payload onto the other decoder fails first.
    const [familyPayload] = encodeFamilySession(familySession, SECRET).split(".");
    const [, parentSig] = encodeParentSession(session, SECRET).split(".");
    expect(decodeParentSession(`${familyPayload}.${parentSig}`, SECRET, 1_500_000)).toBeNull();
  });
});

describe("transport booking cookie", () => {
  const booking: TransportSession = {
    bookingId: "7a1e5b7a-1c1a-4b0e-9c1e-1a2b3c4d5e6f",
    issuedAt: 1_000_000,
    expiresAt: 2_000_000,
  };

  it("round-trips", () => {
    expect(decodeTransportSession(encodeTransportSession(booking, SECRET), SECRET, 1_500_000)).toEqual(booking);
  });

  it("rejects an expired session", () => {
    expect(decodeTransportSession(encodeTransportSession(booking, SECRET), SECRET, 2_000_000)).toBeNull();
  });

  it("rejects a tampered payload and a previous secret", () => {
    const [payload, sig] = encodeTransportSession(booking, SECRET).split(".");
    const other = Buffer.from(JSON.stringify({ b: "another-booking", i: 1, e: 9_999_999 })).toString("base64url");
    expect(decodeTransportSession(`${other}.${sig}`, SECRET, 1_500_000)).toBeNull();
    expect(decodeTransportSession(`${payload}.${sig}x`, SECRET, 1_500_000)).toBeNull();
    expect(decodeTransportSession(encodeTransportSession(booking, "old-secret"), SECRET, 1_500_000)).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    expect(decodeTransportSession("", SECRET)).toBeNull();
    expect(decodeTransportSession("a.b", SECRET)).toBeNull();
    expect(decodeTransportSession(undefined, SECRET)).toBeNull();
  });

  // Anybody can get one of these by filling in the public form, so it is the
  // cookie most worth lifting onto another decoder. None of them may take it,
  // and it may take neither of theirs.
  it("is never read as a parent or family cookie, nor they as it", () => {
    const transportCookie = encodeTransportSession(booking, SECRET);
    expect(decodeParentSession(transportCookie, SECRET, 1_500_000)).toBeNull();
    expect(decodeFamilySession(transportCookie, SECRET, 1_500_000)).toBeNull();
    expect(decodeTransportSession(encodeParentSession(session, SECRET), SECRET, 1_500_000)).toBeNull();
    expect(decodeTransportSession(encodeFamilySession(familySession, SECRET), SECRET, 1_500_000)).toBeNull();
  });

  it("refuses a transport payload re-signed under another domain", () => {
    const [transportPayload] = encodeTransportSession(booking, SECRET).split(".");
    const [, familySig] = encodeFamilySession(familySession, SECRET).split(".");
    expect(decodeFamilySession(`${transportPayload}.${familySig}`, SECRET, 1_500_000)).toBeNull();
  });
});
