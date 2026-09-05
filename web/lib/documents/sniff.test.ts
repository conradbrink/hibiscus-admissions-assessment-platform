import { describe, expect, it } from "vitest";
import { sanitiseFilename, sniffMime } from "@/lib/documents/sniff";

const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe("sniffMime", () => {
  it("recognises the three accepted types by their first bytes", () => {
    expect(sniffMime(pdf)).toBe("application/pdf");
    expect(sniffMime(jpeg)).toBe("image/jpeg");
    expect(sniffMime(png)).toBe("image/png");
  });
  it("refuses anything else, whatever it is called", () => {
    expect(sniffMime(new TextEncoder().encode("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("hello, this is scan.pdf honest"))).toBeNull();
    expect(sniffMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 0]))).toBeNull(); // zip / docx
    expect(sniffMime(new Uint8Array([]))).toBeNull();
    expect(sniffMime(new Uint8Array([0x25, 0x50]))).toBeNull();
  });
});

describe("sanitiseFilename", () => {
  it("keeps the base name only, strips control characters, bounds the length", () => {
    expect(sanitiseFilename("C:\\Users\\kago\\Desktop\\birth cert.PDF")).toBe("birth cert.PDF");
    expect(sanitiseFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitiseFilename("re\u0000port\n.pdf")).toBe("report.pdf");
    expect(sanitiseFilename("   ")).toBe("document");
    expect(sanitiseFilename("x".repeat(500)).length).toBe(200);
  });
});
