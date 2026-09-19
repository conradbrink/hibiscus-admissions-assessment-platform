import { describe, expect, it } from "vitest";
import { ACTION_LABELS, ACTION_TYPES, TRIGGER_LABELS, conditionsMatch, describeAction, parseActions, parseConditions, type TriggerEvent } from "@/lib/crm/automations/rules";

const ev = (payload: TriggerEvent["payload"] = {}): TriggerEvent => ({ id: 1, type: "application_status_changed", family_id: "f1", student_id: null, application_id: "a1", payload });

describe("conditionsMatch", () => {
  it("an empty condition set matches everything", () => {
    expect(conditionsMatch(parseConditions({}), ev())).toBe(true);
    expect(conditionsMatch(parseConditions(null), ev())).toBe(true);
  });
  it("every listed condition must hold", () => {
    const c = parseConditions({ campus_ids: ["c1"], to: ["enrolled", "paid"] });
    expect(conditionsMatch(c, ev({ campus_id: "c1", to: "enrolled" }))).toBe(true);
    expect(conditionsMatch(c, ev({ campus_id: "c2", to: "enrolled" }))).toBe(false);
    expect(conditionsMatch(c, ev({ campus_id: "c1", to: "declined" }))).toBe(false);
  });
  it("a condition the payload cannot answer fails rather than guesses", () => {
    expect(conditionsMatch(parseConditions({ heard_from: ["referral"] }), ev({}))).toBe(false);
    expect(conditionsMatch(parseConditions({ heard_from: ["referral"] }), ev({ heard_from: 7 }))).toBe(false);
  });
  it("lifecycle stage comes from the family, not the payload", () => {
    const c = parseConditions({ lifecycle_stages: ["active"] });
    expect(conditionsMatch(c, ev({ lifecycle_stage: "active" }))).toBe(false);
    expect(conditionsMatch(c, ev(), "active")).toBe(true);
  });
});

describe("parseActions", () => {
  it("accepts every kind of action with its fields tidied", () => {
    const r = parseActions([
      { type: "create_task", title: "  Call the family ", due_days: 2, priority: "high", assign: "assignee" },
      { type: "send_email", template_key: "crm_welcome_family", link: "family" },
      { type: "send_whatsapp", template_key: "crm_welcome_family", link: "nowhere" },
      { type: "assign_staff", staff: "application_owner" },
      { type: "set_follow_up", days: 3 },
      { type: "add_tag", tag: "vip" },
      { type: "remove_tag", tag: "new-lead" },
      { type: "create_opportunity", type_code: "robotics" },
      { type: "resolve_opportunity", type_code: "robotics" },
      { type: "set_lifecycle", stage: "inactive" },
      { type: "notify", to: "assignee", title: "Look" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.actions[0]).toEqual({ type: "create_task", title: "Call the family", details: undefined, due_days: 2, priority: "high", assign: "assignee" });
    expect(r.actions[2]).toEqual({ type: "send_whatsapp", template_key: "crm_welcome_family", link: undefined });
    expect(r.actions.map((a) => a.type)).toEqual(ACTION_TYPES);
  });
  it("refuses what the engine could not run, naming the item", () => {
    const r = parseActions([
      { type: "create_task" },
      { type: "send_email", template_key: "Not A Key" },
      { type: "add_tag", tag: "VIP!" },
      { type: "set_follow_up", days: -1 },
      { type: "teleport" },
      "nope",
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("refuses a non-list", () => {
    expect(parseActions({ type: "add_tag", tag: "x" }).ok).toBe(false);
  });
  it("defaults an unknown priority to normal", () => {
    const r = parseActions([{ type: "create_task", title: "x", priority: "asap" }]);
    expect(r.ok && r.actions[0].type === "create_task" && r.actions[0].priority).toBe("normal");
  });
});

describe("words", () => {
  it("labels every action and trigger", () => {
    for (const t of ACTION_TYPES) expect(ACTION_LABELS[t]).toBeTruthy();
    for (const t of Object.keys(TRIGGER_LABELS)) expect(TRIGGER_LABELS[t as keyof typeof TRIGGER_LABELS]).toBeTruthy();
  });
  it("describes an action in one line", () => {
    expect(describeAction({ type: "create_task", title: "Call", due_days: 1, assign: "assignee" })).toBe('Task "Call" due in 1 day for the family\'s assignee');
    expect(describeAction({ type: "send_whatsapp", template_key: "k" })).toContain("consent");
  });
});
