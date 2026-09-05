import { describe, expect, it } from "vitest";
import { amountMatches, decimalToMinor, minorToDecimal } from "@/lib/payments/amounts";
import { buildCreateTokenXml, buildVerifyTokenXml, dpoServiceDate, mapVerifyResult, parseDpoResponse } from "@/lib/payments/dpo-xml";

const input = {
  companyToken: "9F416C11-127B-4DE2-AC7F-D5710E4C5E0A",
  serviceType: "3854",
  amountMinor: 750_000,
  currency: "BWP",
  companyRef: "HBS-2026-00012-3F2A9C1B",
  description: "Registration & admission fees — HBS-2026-00012",
  redirectUrl: "https://admissions.example/pay/return",
  backUrl: "https://admissions.example/pay?cancelled=1",
  ptlHours: 24,
  customer: { email: "kago@example.com", firstName: "Kago", lastName: "O'Moeti" },
  serviceDate: "2026/09/05 08:00",
};

describe("createToken", () => {
  it("builds the documented v6 request with escaped text and a decimal amount", () => {
    const xml = buildCreateTokenXml(input);
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?><API3G><CompanyToken>9F416C11-127B-4DE2-AC7F-D5710E4C5E0A</CompanyToken><Request>createToken</Request><Transaction>')).toBe(true);
    expect(xml).toContain("<PaymentAmount>7500.00</PaymentAmount>");
    expect(xml).toContain("<PaymentCurrency>BWP</PaymentCurrency>");
    expect(xml).toContain("<CompanyRef>HBS-2026-00012-3F2A9C1B</CompanyRef>");
    expect(xml).toContain("<CompanyRefUnique>1</CompanyRefUnique>");
    expect(xml).toContain("<PTL>24</PTL>");
    expect(xml).toContain("<customerLastName>O&apos;Moeti</customerLastName>");
    expect(xml).toContain("<ServiceDescription>Registration &amp; admission fees — HBS-2026-00012</ServiceDescription>");
    expect(xml).toContain("<ServiceType>3854</ServiceType>");
    expect(xml.endsWith("</Service></Services></API3G>")).toBe(true);
  });

  it("builds the verify request", () => {
    expect(buildVerifyTokenXml("TOKEN", "72983CAC-5DB1-4C7F-BD88-352066B71592")).toBe(
      '<?xml version="1.0" encoding="utf-8"?><API3G><CompanyToken>TOKEN</CompanyToken><Request>verifyToken</Request><TransactionToken>72983CAC-5DB1-4C7F-BD88-352066B71592</TransactionToken></API3G>'
    );
  });
});

describe("responses", () => {
  const paid = `<?xml version="1.0" encoding="utf-8"?><API3G><Result>000</Result><ResultExplanation>Transaction Paid</ResultExplanation><CustomerName>Kago Moeti</CustomerName><TransactionApproval>123456</TransactionApproval><TransactionCurrency>BWP</TransactionCurrency><TransactionAmount>7500.00</TransactionAmount><TransactionNetAmount>7275.00</TransactionNetAmount><CardNumber>4111********1111</CardNumber></API3G>`;

  it("reads only the allow-listed tags and never the card number", () => {
    const r = parseDpoResponse(paid);
    expect(r.Result).toBe("000");
    expect(r.TransactionAmount).toBe("7500.00");
    expect(r.TransactionCurrency).toBe("BWP");
    expect(r.TransactionApproval).toBe("123456");
    expect(JSON.stringify(r)).not.toContain("4111");
  });

  it("maps result codes", () => {
    expect(mapVerifyResult("000")).toBe("paid");
    expect(mapVerifyResult("900")).toBe("pending");
    expect(mapVerifyResult("901")).toBe("failed");
    expect(mapVerifyResult("904")).toBe("failed");
    expect(mapVerifyResult("903")).toBe("expired");
    expect(mapVerifyResult("950")).toBe("failed");
    expect(mapVerifyResult(undefined)).toBe("failed");
  });

  it("copes with a malformed body", () => {
    expect(parseDpoResponse("<html>Bad Gateway</html>")).toEqual({});
    expect(parseDpoResponse("<API3G><Result>900</Result></API3G>").ResultExplanation).toBeUndefined();
  });

  it("unescapes entities in explanations", () => {
    expect(parseDpoResponse("<API3G><ResultExplanation>Token &amp; amount mismatch</ResultExplanation></API3G>").ResultExplanation).toBe("Token & amount mismatch");
  });
});

describe("amounts", () => {
  it("round-trips minor units and decimal strings", () => {
    expect(minorToDecimal(750_000)).toBe("7500.00");
    expect(minorToDecimal(5)).toBe("0.05");
    expect(decimalToMinor("7500.00")).toBe(750_000);
    expect(decimalToMinor("7,500.5")).toBe(750_050);
    expect(decimalToMinor("abc")).toBeNull();
    expect(decimalToMinor(undefined)).toBeNull();
  });

  it("matches only the exact amount and currency", () => {
    const row = { amount_minor: 750_000, currency: "BWP" };
    expect(amountMatches(row, { amountMinor: 750_000, currency: "BWP" })).toBe(true);
    expect(amountMatches(row, { amountMinor: 750_000, currency: "bwp" })).toBe(true);
    expect(amountMatches(row, { amountMinor: 749_999, currency: "BWP" })).toBe(false);
    expect(amountMatches(row, { amountMinor: 750_000, currency: "ZAR" })).toBe(false);
    expect(amountMatches(row, { amountMinor: null, currency: "BWP" })).toBe(false);
  });

  it("formats the service date the way DPO documents it", () => {
    expect(dpoServiceDate(new Date("2026-09-05T08:03:00Z"))).toBe("2026/09/05 08:03");
  });
});
