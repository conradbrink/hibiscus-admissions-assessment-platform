import { describe, expect, it } from "vitest";
import { bounceReason } from "@/lib/email/bounce";

describe("bounceReason", () => {
  it("keeps the classification and the prose together", () => {
    expect(
      bounceReason("bounced", {
        type: "Permanent",
        subType: "NoEmail",
        message: "The recipient's email address does not exist.",
      })
    ).toBe("Permanent/NoEmail: The recipient's email address does not exist.");
  });

  // The classification is the half that decides what to do, so it has to
  // survive a provider that sends no prose. "Permanent/NoEmail" means ring the
  // family; "Transient/MailboxFull" means send again later.
  it("falls back to the classification alone", () => {
    expect(bounceReason("bounced", { type: "Transient", subType: "MailboxFull" })).toBe(
      "Transient/MailboxFull"
    );
  });

  it("falls back to the prose alone", () => {
    expect(bounceReason("bounced", { message: "Mailbox unavailable" })).toBe("Mailbox unavailable");
  });

  /**
   * Null, not "Unknown bounce". An empty column reads honestly as "we were not
   * told"; a placeholder reads like a finding and sends somebody looking for a
   * cause that was never reported.
   */
  it("says nothing when the provider said nothing", () => {
    expect(bounceReason("bounced", undefined)).toBeNull();
    expect(bounceReason("bounced", {})).toBeNull();
    expect(bounceReason("bounced", { message: "   " })).toBeNull();
  });

  it("records a spam complaint, which carries no bounce payload", () => {
    expect(bounceReason("complained", undefined)).toBe("Marked as spam by the recipient");
  });

  // A delivery is not a failure, and writing anything here would overwrite a
  // real send error on a message that later succeeded.
  it("is silent on the kinds that are not failures", () => {
    expect(bounceReason("delivered", { message: "ignored" })).toBeNull();
    expect(bounceReason("opened", undefined)).toBeNull();
    expect(bounceReason("clicked", undefined)).toBeNull();
  });

  it("truncates provider prose that runs long", () => {
    const reason = bounceReason("bounced", { message: "x".repeat(900) });
    expect(reason).toHaveLength(500);
    expect(reason?.endsWith("…")).toBe(true);
  });
});
