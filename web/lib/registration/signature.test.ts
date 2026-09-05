import { describe, expect, it } from "vitest";
import { inkLength, parseSignature, signatureDataUrl, signatureSvg, SIGNATURE_HEIGHT, SIGNATURE_WIDTH } from "@/lib/registration/signature";

const line = (n = 12, step = 10): number[][] => Array.from({ length: n }, (_, i) => [20 + i * step, 100]);

describe("parseSignature", () => {
  it("accepts a drawn line and rounds the points", () => {
    const r = parseSignature(JSON.stringify([[[10.26, 20.44], [150.01, 60]]]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.strokes).toEqual([[[10.3, 20.4], [150, 60]]]);
  });
  it("refuses nothing, a tap, and anything that is not strokes", () => {
    expect(parseSignature("")).toEqual({ ok: false, reason: "empty" });
    expect(parseSignature("[]")).toEqual({ ok: false, reason: "empty" });
    expect(parseSignature(JSON.stringify([[[100, 100]]]))).toEqual({ ok: false, reason: "too_small" });
    expect(parseSignature(JSON.stringify([[[100, 100], [110, 100]]]))).toEqual({ ok: false, reason: "too_small" });
    expect(parseSignature("not json")).toEqual({ ok: false, reason: "malformed" });
    expect(parseSignature(JSON.stringify({ d: "M0 0" }))).toEqual({ ok: false, reason: "malformed" });
    expect(parseSignature(JSON.stringify([[[1, "2"]]]))).toEqual({ ok: false, reason: "malformed" });
    expect(parseSignature(JSON.stringify([[[1, 2, 3]]]))).toEqual({ ok: false, reason: "malformed" });
    expect(parseSignature(JSON.stringify([[[Infinity, 2]]]))).toEqual({ ok: false, reason: "malformed" });
  });
  it("clamps points into the box and caps the amount of data", () => {
    const r = parseSignature(JSON.stringify([[[-50, 900], [9999, -1]]]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.strokes).toEqual([[[0, SIGNATURE_HEIGHT], [SIGNATURE_WIDTH, 0]]]);
    const tooMany = Array.from({ length: 4001 }, (_, i) => [i % 600, 100]);
    expect(parseSignature(JSON.stringify([tooMany]))).toEqual({ ok: false, reason: "malformed" });
    expect(parseSignature(JSON.stringify(Array.from({ length: 201 }, () => line(2))))).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("signatureSvg", () => {
  it("renders a path from the numbers only", () => {
    const r = parseSignature(JSON.stringify([line(12), [[300.5, 50]]]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const svg = signatureSvg(r.strokes);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).toContain('d="M20 100 L30 100 L40 100');
    expect(svg).toContain('L130 100 M300.5 50 L300.5 50"');
    expect(svg).not.toMatch(/<script|on[a-z]+=/i);
    expect(signatureDataUrl(svg).startsWith("data:image/svg+xml;charset=utf-8,%3Csvg")).toBe(true);
  });
  it("measures ink across strokes", () => {
    expect(inkLength([[[0, 0], [30, 40]], [[0, 0], [0, 10]]])).toBe(60);
  });
});
