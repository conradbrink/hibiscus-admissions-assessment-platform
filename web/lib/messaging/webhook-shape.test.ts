import { describe, expect, it } from "vitest";
import { describeWebhookShape } from "@/lib/messaging/webhook-shape";

describe("describeWebhookShape", () => {
  it("names the event and the keys around it", () => {
    const shape = describeWebhookShape(JSON.stringify({ type: "message.inbound", data: { id: "m1", from: "+2677", text: "hello" } }));
    expect(shape.type).toBe("message.inbound");
    expect(shape.keys).toEqual(["type", "data"]);
    expect(shape.inner.data).toEqual(["id", "from", "text"]);
  });

  it("finds the event under the other spellings providers use", () => {
    expect(describeWebhookShape(JSON.stringify({ event: "message.received" })).type).toBe("message.received");
    expect(describeWebhookShape(JSON.stringify({ eventType: "MessageReceived" })).type).toBe("MessageReceived");
    expect(describeWebhookShape(JSON.stringify({ event_type: "inbound" })).type).toBe("inbound");
  });

  // The whole point of keys-not-values: this runs on real parents' messages.
  it("keeps no values but the event name", () => {
    const raw = JSON.stringify({
      type: "message.inbound",
      data: { from: "+26776642259", text: "Has my son been accepted?", contact: { name: "Neo Moeng" } },
    });
    const dumped = JSON.stringify(describeWebhookShape(raw));
    expect(dumped).not.toContain("26776642259");
    expect(dumped).not.toContain("Has my son");
    expect(dumped).not.toContain("Neo Moeng");
    expect(dumped).toContain("message.inbound");
  });

  it("does not mistake the parent's words for an event name", () => {
    const prose = "hello there, I am writing about my daughter's application and wanted to ask whether the assessment date has moved";
    expect(describeWebhookShape(JSON.stringify({ name: prose })).type).toBeNull();
  });

  it("reaches one level down, and marks an array without unpacking it", () => {
    const shape = describeWebhookShape(JSON.stringify({ type: "x", entry: [{ changes: [] }], meta: {} }));
    expect(shape.inner.entry).toEqual(["[]"]);
    expect(shape.inner.meta).toBeUndefined();
  });

  it("says so when the body is not JSON we can read", () => {
    expect(describeWebhookShape("not json at all").unparsable).toBe(true);
    expect(describeWebhookShape("[1,2,3]").unparsable).toBe(true);
    expect(describeWebhookShape("").unparsable).toBe(true);
  });

  it("survives a body with no event name at all", () => {
    const shape = describeWebhookShape(JSON.stringify({ data: { id: "m1" } }));
    expect(shape.type).toBeNull();
    expect(shape.keys).toEqual(["data"]);
  });
});
