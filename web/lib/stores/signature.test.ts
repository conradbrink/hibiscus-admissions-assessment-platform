import { describe, expect, it } from "vitest";
import { asDrawing, drawingDataUrl, drawingHeight, drawingSvg, parseDrawing } from "@/lib/stores/signature";

const good = { w: 600, h: 300, strokes: [[[10, 100], [120, 110], [260, 90], [400, 140]]] };

describe("parseDrawing", () => {
  it("accepts a real signature and keeps its box", () => {
    const r = parseDrawing(JSON.stringify(good));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.drawing).toMatchObject({ w: 600, h: 300 });
  });
  it("refuses nothing, a tap and garbage", () => {
    expect(parseDrawing("")).toEqual({ ok: false, reason: "empty" });
    expect(parseDrawing(JSON.stringify({ ...good, strokes: [] }))).toEqual({ ok: false, reason: "empty" });
    expect(parseDrawing(JSON.stringify({ ...good, strokes: [[[1, 1], [3, 3]]] }))).toEqual({ ok: false, reason: "too_small" });
    expect(parseDrawing("{not json")).toEqual({ ok: false, reason: "malformed" });
    expect(parseDrawing("[[[1,2]]]")).toEqual({ ok: false, reason: "malformed" });
  });
  it("refuses a point outside the box and anything extra in the object", () => {
    expect(parseDrawing(JSON.stringify({ ...good, strokes: [[[10, 10], [700, 10]]] })).ok).toBe(false);
    expect(parseDrawing(JSON.stringify({ ...good, svg: "<script>alert(1)</script>" })).ok).toBe(false);
    expect(parseDrawing(JSON.stringify({ ...good, strokes: [[[10, 10], ["20", 10]]] })).ok).toBe(false);
  });
  it("refuses a box no pad could have", () => {
    expect(parseDrawing(JSON.stringify({ ...good, h: 5000 })).ok).toBe(false);
    expect(parseDrawing(JSON.stringify({ ...good, w: 10 })).ok).toBe(false);
  });
});

describe("drawingHeight", () => {
  it("follows the pad's shape, within bounds", () => {
    expect(drawingHeight(343, 240)).toBe(420);
    expect(drawingHeight(700, 240)).toBe(206);
    expect(drawingHeight(0, 0)).toBe(200);
    expect(drawingHeight(100, 1000)).toBe(1200);
  });
});

describe("drawingSvg", () => {
  it("is built from numbers and replays in the box it was drawn in", () => {
    const svg = drawingSvg({ w: 600, h: 300, strokes: [[[1, 2], [3.25, 4]]] });
    expect(svg).toContain('viewBox="0 0 600 300"');
    expect(svg).toContain("M1 2 L3.3 4");
    expect(drawingDataUrl({ w: 600, h: 300, strokes: [[[1, 2]]] })).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
  });
  it("reads back only what is a drawing", () => {
    expect(asDrawing(good)).not.toBeNull();
    expect(asDrawing({ strokes: [] })).toBeNull();
    expect(asDrawing(null)).toBeNull();
  });
});
