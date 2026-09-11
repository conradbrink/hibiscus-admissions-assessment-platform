import { describe, expect, it } from "vitest";
import { deliveryProof, resolveStatus } from "@/lib/messaging/delivery";

const out = (over: Partial<Parameters<typeof deliveryProof>[0]> = {}) => ({
  direction: "out",
  status: "sent",
  error: null as string | null,
  ...over,
});

describe("resolveStatus", () => {
  it("moves a message forward", () => {
    expect(resolveStatus("queued", "sent")).toEqual({ status: "sent", applied: true });
    expect(resolveStatus("sent", "delivered")).toEqual({ status: "delivered", applied: true });
    expect(resolveStatus("delivered", "read")).toEqual({ status: "read", applied: true });
  });

  it("refuses to move it backwards, and says the assertion was not applied", () => {
    // The receipt still happened; `applied: false` is what puts it on the
    // trail without letting it rewrite the message's state.
    expect(resolveStatus("delivered", "sent")).toEqual({ status: "delivered", applied: false });
    expect(resolveStatus("read", "delivered")).toEqual({ status: "read", applied: false });
  });

  it("treats a repeat as a no-op", () => {
    expect(resolveStatus("delivered", "delivered")).toEqual({ status: "delivered", applied: false });
  });

  it("lets a late failure win, because that one is real", () => {
    // A message can reach the network and still fail at the handset, so
    // `failed` is the one status allowed to arrive after `read`.
    expect(resolveStatus("read", "failed")).toEqual({ status: "failed", applied: true });
  });

  it("does not throw on a status it has never heard of", () => {
    expect(resolveStatus("delivered", "banana")).toEqual({ status: "delivered", applied: false });
    expect(resolveStatus("banana", "sent")).toEqual({ status: "sent", applied: true });
  });
});

describe("deliveryProof", () => {
  it("keeps 'accepted by WhatsApp' apart from 'on the phone'", () => {
    // This distinction is the whole point. Thirteen templates were accepted
    // and never delivered, because the button parameter was malformed; the
    // console said "sent" for every one of them.
    expect(deliveryProof(out({ status: "sent" }))).toEqual({
      summary: "Accepted by WhatsApp, not yet confirmed on the phone",
      confirmed: false,
    });
    expect(deliveryProof(out({ status: "delivered" })).confirmed).toBe(true);
    expect(deliveryProof(out({ status: "read" })).confirmed).toBe(true);
  });

  it("gives the reason when there is one", () => {
    expect(deliveryProof(out({ status: "failed", error: "not on WhatsApp" })).summary).toBe("Not delivered: not on WhatsApp");
    expect(deliveryProof(out({ status: "skipped", error: "the parent has not opted in to WhatsApp" })).summary).toBe(
      "Not sent: the parent has not opted in to WhatsApp"
    );
  });

  it("still reads sensibly with no reason recorded", () => {
    expect(deliveryProof(out({ status: "failed", error: null })).summary).toBe("Not delivered");
    expect(deliveryProof(out({ status: "skipped", error: null })).summary).toBe("Not sent");
  });

  it("never claims an unsent message is confirmed", () => {
    for (const status of ["queued", "sent", "failed", "skipped"]) {
      expect(deliveryProof(out({ status })).confirmed).toBe(false);
    }
  });

  it("reads a parent's own message as received", () => {
    expect(deliveryProof(out({ direction: "in", status: "received" }))).toEqual({
      summary: "Received from the parent",
      confirmed: true,
    });
  });
});
