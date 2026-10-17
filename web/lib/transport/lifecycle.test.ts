import { describe, expect, it } from "vitest";
import { transportRetentionDue, unpaidExpiryDue } from "@/lib/transport/lifecycle";

const NOW = new Date("2027-03-10T12:00:00Z");

describe("unpaidExpiryDue", () => {
  const row = (over: Partial<Parameters<typeof unpaidExpiryDue>[0][number]>) => ({
    id: "b",
    status: "awaiting_payment",
    created_at: "2027-03-06T12:00:00Z",
    has_payment_in_flight: false,
    ...over,
  });

  it("expires a booking left unpaid past the window", () => {
    expect(unpaidExpiryDue([row({})], 72, NOW)).toEqual(["b"]);
  });

  it("leaves one still inside it", () => {
    expect(unpaidExpiryDue([row({ created_at: "2027-03-08T12:00:00Z" })], 72, NOW)).toEqual([]);
  });

  it("leaves a booking whose parent is on the gateway's page", () => {
    expect(unpaidExpiryDue([row({ has_payment_in_flight: true })], 72, NOW)).toEqual([]);
  });

  it("never touches a paid or cancelled booking", () => {
    expect(unpaidExpiryDue([row({ status: "paid" }), row({ status: "cancelled" })], 72, NOW)).toEqual([]);
  });
});

describe("transportRetentionDue", () => {
  const settings = { transportRetentionDays: 730, transportUnpaidRetentionDays: 30 };
  const row = (over: Partial<Parameters<typeof transportRetentionDue>[0][number]>) => ({
    id: "b",
    status: "paid",
    updated_at: "2027-01-01T00:00:00Z",
    period_ends_on: "2024-12-01",
    anonymised_at: null,
    ...over,
  });

  it("clears a paid booking two years after its period ended", () => {
    expect(transportRetentionDue([row({})], settings, "2027-03-10", NOW)).toEqual(["b"]);
    expect(transportRetentionDue([row({ period_ends_on: "2026-12-01" })], settings, "2027-03-10", NOW)).toEqual([]);
  });

  it("clears an expired booking a month after it stopped", () => {
    expect(transportRetentionDue([row({ status: "expired", updated_at: "2027-01-20T00:00:00Z" })], settings, "2027-03-10", NOW)).toEqual(["b"]);
    expect(transportRetentionDue([row({ status: "expired", updated_at: "2027-03-01T00:00:00Z" })], settings, "2027-03-10", NOW)).toEqual([]);
  });

  it("never clears a booking still awaiting payment, or one already cleared", () => {
    expect(transportRetentionDue([row({ status: "awaiting_payment" })], settings, "2027-03-10", NOW)).toEqual([]);
    expect(transportRetentionDue([row({ anonymised_at: "2027-01-01T00:00:00Z" })], settings, "2027-03-10", NOW)).toEqual([]);
  });
});
