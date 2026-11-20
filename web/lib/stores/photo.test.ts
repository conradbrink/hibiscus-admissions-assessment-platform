import { describe, expect, it } from "vitest";
import { fromByteaHex, isJpeg, itemPhotoUrl, stripJpegMetadata, toByteaHex } from "@/lib/stores/photo";

/** A segment: marker, two-byte length, payload. */
const seg = (marker: number, payload: number[]) => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];
const GPS = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x47, 0x50, 0x53]; // "Exif\0\0GPS"

function jpeg(...segments: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), 0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9]);
}

describe("stripJpegMetadata", () => {
  it("takes out the EXIF and IPTC segments and keeps the rest", () => {
    const jfif = seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00]);
    const icc = seg(0xe2, [1, 2, 3]);
    const out = stripJpegMetadata(jpeg(jfif, seg(0xe1, GPS), icc, seg(0xed, [9, 9])));
    expect(out).not.toBeNull();
    const hex = Buffer.from(out!).toString("hex");
    expect(hex).not.toContain(Buffer.from(GPS).toString("hex"));
    expect(hex).toContain(Buffer.from(jfif).toString("hex"));
    expect(hex).toContain(Buffer.from(icc).toString("hex"));
    expect(hex.endsWith("112233ffd9")).toBe(true);
  });
  it("leaves a clean JPEG as it was", () => {
    const clean = jpeg(seg(0xe0, [1, 2]));
    expect(Buffer.from(stripJpegMetadata(clean)!).equals(Buffer.from(clean))).toBe(true);
  });
  it("refuses what is not a JPEG, or is cut short", () => {
    expect(stripJpegMetadata(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(stripJpegMetadata(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 1, 2]))).toBeNull();
    expect(isJpeg(Uint8Array.from([0x3c, 0x73, 0x76, 0x67]))).toBe(false);
  });
});

describe("photo addresses and bytea", () => {
  it("versions the address by the photo's hash", () => {
    expect(itemPhotoUrl("abc", "0123456789abcdef0123")).toBe("/staff/stores/inventory/abc/photo?v=0123456789abcdef");
    expect(itemPhotoUrl("abc", null)).toBeNull();
  });
  it("round-trips PostgREST's bytea text", () => {
    const b = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
    expect(toByteaHex(b)).toBe("\\xffd8ff00");
    expect(Array.from(fromByteaHex("\\xffd8ff00")!)).toEqual([0xff, 0xd8, 0xff, 0x00]);
    expect(fromByteaHex("nope")).toBeNull();
  });
});
