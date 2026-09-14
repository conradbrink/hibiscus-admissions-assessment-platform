import { describe, expect, it } from "vitest";
import { isStaleConflict } from "./stale-conflict";

describe("isStaleConflict", () => {
  it("recognises the engine's own expected-status conflict", () => {
    expect(isStaleConflict({ code: "status_conflict", message: "status_conflict: expected registration_complete, found enrolled" })).toBe(true);
  });
  it("lets a precondition written for the person through", () => {
    expect(isStaleConflict({ code: "status_conflict", message: "Accept or reject the documents first: birth certificate." })).toBe(false);
    expect(isStaleConflict({ code: "status_conflict", message: "This offer has already been answered." })).toBe(false);
  });
  it("is not fooled by another code carrying the word", () => {
    expect(isStaleConflict({ code: "database", message: "status_conflict" })).toBe(false);
  });
});
