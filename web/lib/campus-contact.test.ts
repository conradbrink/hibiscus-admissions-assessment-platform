import { describe, expect, it } from "vitest";
import { streetLine, telHref, whatsappHref } from "@/lib/campus-contact";

describe("telHref", () => {
  it("strips the spaces the school writes and keeps the plus", () => {
    expect(telHref("+267 392 4299")).toBe("tel:+2673924299");
  });

  it("handles a number written without a country code", () => {
    expect(telHref("392 4299")).toBe("tel:3924299");
  });

  it("refuses something too short to be a number", () => {
    expect(telHref("12345")).toBeNull();
    expect(telHref("n/a")).toBeNull();
  });

  it("has nothing to offer when the campus has no number", () => {
    expect(telHref(null)).toBeNull();
    expect(telHref("")).toBeNull();
    expect(telHref("   ")).toBeNull();
  });
});

describe("whatsappHref", () => {
  it("builds wa.me from the international number, without the plus", () => {
    expect(whatsappHref("+267 72 320 145")).toBe("https://wa.me/26772320145");
  });

  it("carries an opening message when one is given", () => {
    expect(whatsappHref("+267 72 320 145", { text: "Hello, about John's place" })).toBe(
      "https://wa.me/26772320145?text=Hello%2C%20about%20John's%20place"
    );
  });

  it("will not link a number with no country code", () => {
    // wa.me would resolve it against the reader's own country, which for a
    // parent abroad reaches a stranger.
    expect(whatsappHref("72 320 145")).toBeNull();
  });

  it("refuses a plus with too few digits behind it", () => {
    expect(whatsappHref("+267")).toBeNull();
  });
});

describe("streetLine", () => {
  it("takes the street address out of the printing blob", () => {
    expect(streetLine("Plot 59140, Block 7, Gaborone\n+267 392 4299\nMain office +267 72 320 145")).toBe(
      "Plot 59140, Block 7, Gaborone"
    );
  });

  it("copes with the Windows line endings one campus was typed with", () => {
    expect(streetLine("Potchefstroom CBD, South Africa\r\n+267 72 320 145")).toBe("Potchefstroom CBD, South Africa");
  });

  it("returns null rather than an empty string", () => {
    expect(streetLine(null)).toBeNull();
    expect(streetLine("\n+267 72 320 145")).toBeNull();
  });
});
