import { describe, expect, it } from "vitest";
import {
  hasUsableFactor,
  MFA_SECURITY_PATH,
  MFA_VERIFY_PATH,
  mfaOutcome,
  mfaPathAllowed,
  mfaRedirectPath,
  type MfaState,
} from "@/lib/staff/mfa";

const state = (over: Partial<MfaState> = {}): MfaState => ({
  hasVerifiedFactor: false,
  currentLevel: "aal1",
  requiredBySchool: false,
  ...over,
});

const verified = [{ status: "verified" as const }];
const unverified = [{ status: "unverified" as const }];

describe("who has to present a second factor", () => {
  it("asks nothing of somebody who has already presented one", () => {
    expect(mfaOutcome(state({ hasVerifiedFactor: true, currentLevel: "aal2" }))).toBe("ok");
    expect(mfaOutcome(state({ hasVerifiedFactor: true, currentLevel: "aal2", requiredBySchool: true }))).toBe("ok");
  });

  it("challenges somebody who set one up", () => {
    expect(mfaOutcome(state({ hasVerifiedFactor: true }))).toBe("verify");
  });

  it("still challenges them when the school does not require it", () => {
    // The finding this ordering exists for: if the school's switch could skip
    // an enrolled person's own factor, their password would quietly become
    // sufficient again and nothing would tell them. Opting in is theirs to
    // decide; opting out is not somebody else's.
    expect(mfaOutcome(state({ hasVerifiedFactor: true, requiredBySchool: false }))).toBe("verify");
  });

  it("asks nothing of somebody with none, until the school requires it", () => {
    expect(mfaOutcome(state())).toBe("ok");
    expect(mfaOutcome(state({ requiredBySchool: true }))).toBe("enrol");
  });

  it("never demands a code for a factor that cannot produce one", () => {
    // A half-finished enrolment: the row exists, no authenticator app ever
    // received the secret. Treating it as a challenge is a locked door with no
    // key, which is the worst outcome this module can have.
    //
    // `hasUsableFactor` is how a factor list becomes the boolean the decision
    // takes, and it is the filter that keeps the trap shut. On the server the
    // same filter is Supabase's: nextLevel is aal2 only for verified factors.
    expect(hasUsableFactor(unverified)).toBe(false);
    expect(mfaOutcome(state({ hasVerifiedFactor: hasUsableFactor(unverified) }))).toBe("ok");
    expect(mfaOutcome(state({ hasVerifiedFactor: hasUsableFactor(unverified), requiredBySchool: true }))).toBe("enrol");
    // One usable factor among abandoned ones is still usable.
    expect(hasUsableFactor([...unverified, ...verified])).toBe(true);
    expect(mfaOutcome(state({ hasVerifiedFactor: hasUsableFactor([...unverified, ...verified]) }))).toBe("verify");
    expect(hasUsableFactor([])).toBe(false);
  });

  it("treats a session that is not signed in as nothing to decide", () => {
    // The proxy has already bounced a signed-out request to the login page;
    // this must not invent a second reason to redirect on top of that.
    expect(mfaOutcome(state({ currentLevel: null }))).toBe("ok");
    expect(mfaOutcome(state({ currentLevel: null, hasVerifiedFactor: true }))).toBe("verify");
  });
});

describe("what a person may reach before they have finished", () => {
  it("always lets somebody sign in or recover a password", () => {
    for (const outcome of ["ok", "verify", "enrol"] as const) {
      for (const path of ["/staff/login", "/staff/forgot-password", "/staff/reset-password"]) {
        expect(mfaPathAllowed(outcome, path)).toBe(true);
      }
    }
  });

  it("opens everything once there is nothing outstanding", () => {
    for (const path of ["/staff", "/staff/applications", MFA_SECURITY_PATH, MFA_VERIFY_PATH]) {
      expect(mfaPathAllowed("ok", path)).toBe(true);
    }
  });

  it("leaves exactly one road out of each outcome", () => {
    expect(mfaPathAllowed("verify", MFA_VERIFY_PATH)).toBe(true);
    expect(mfaPathAllowed("enrol", MFA_SECURITY_PATH)).toBe(true);
    expect(mfaRedirectPath("verify")).toBe(MFA_VERIFY_PATH);
    expect(mfaRedirectPath("enrol")).toBe(MFA_SECURITY_PATH);
  });

  it("does not let a password alone reach the page that removes a factor", () => {
    // This is the privilege boundary, not a tidiness rule: the security page
    // is where a factor comes off, so reaching it with only a password is how
    // a stolen password becomes a full account again.
    expect(mfaPathAllowed("verify", MFA_SECURITY_PATH)).toBe(false);
    expect(mfaPathAllowed("verify", "/staff/security/anything")).toBe(false);
  });

  it("does not let somebody who must enrol wander into the console", () => {
    for (const path of ["/staff", "/staff/applications", "/staff/admin/staff", "/staff/payments"]) {
      expect(mfaPathAllowed("enrol", path)).toBe(false);
      expect(mfaPathAllowed("verify", path)).toBe(false);
    }
  });

  it("matches on path segments, not on a string prefix", () => {
    // `/staff/logout-everywhere` must not be exempt because it begins with
    // `/staff/log`. A prefix check without the boundary is how an unintended
    // page becomes reachable.
    expect(mfaPathAllowed("verify", "/staff/loginsomething")).toBe(false);
    expect(mfaPathAllowed("verify", "/staff/verifying")).toBe(false);
    expect(mfaPathAllowed("enrol", "/staff/securityx")).toBe(false);
    // The real ones, and their children, still pass.
    expect(mfaPathAllowed("verify", "/staff/login")).toBe(true);
    expect(mfaPathAllowed("enrol", "/staff/security")).toBe(true);
  });
});
