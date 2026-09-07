import { describe, expect, it } from "vitest";
import { PAYGATE_TEST_ID, PAYGATE_TEST_KEY, buildInitiateFields, buildQueryFields, checksumOf, checksumValid, encodeForm, keepFields, mapTransactionStatus, parseWire, paygateDate, processChecksum } from "@/lib/payments/paygate-wire";

describe("PayWeb 3 wire", () => {
  it("seals initiate.trans with an MD5 over the values in order plus the key", () => {
    const fields = buildInitiateFields(
      { paygateId: PAYGATE_TEST_ID, reference: "HBS-2026-00008-ABCD1234", amountMinor: 530000, currency: "BWP", returnUrl: "https://a.example/pay/return", transactionDate: "2026-09-07 17:00:00", email: "p@example.com", notifyUrl: "https://a.example/api/webhooks/paygate" },
      PAYGATE_TEST_KEY
    );
    expect(fields.map(([k]) => k)).toEqual(["PAYGATE_ID", "REFERENCE", "AMOUNT", "CURRENCY", "RETURN_URL", "TRANSACTION_DATE", "LOCALE", "COUNTRY", "EMAIL", "NOTIFY_URL", "CHECKSUM"]);
    const values = fields.slice(0, -1).map(([, v]) => v);
    expect(fields.at(-1)?.[1]).toBe(checksumOf(values, PAYGATE_TEST_KEY));
    expect(values[3]).toBe("BWP");
    expect(values[7]).toBe("BWA");
    expect(encodeForm(fields)).toContain("AMOUNT=530000");
  });

  it("refuses a non-integer amount", () => {
    expect(() => buildInitiateFields({ paygateId: "1", reference: "r", amountMinor: 12.5, currency: "ZAR", returnUrl: "u", transactionDate: "d", email: "e" }, "k")).toThrow();
  });

  it("validates a reply's checksum over the fields in the order they arrived", () => {
    const body = `PAYGATE_ID=${PAYGATE_TEST_ID}&PAY_REQUEST_ID=23B785AE-C96C-32AF-4879-D2C9363DB6E8&REFERENCE=pgtest_123456789`;
    const sum = checksumOf([PAYGATE_TEST_ID, "23B785AE-C96C-32AF-4879-D2C9363DB6E8", "pgtest_123456789"], PAYGATE_TEST_KEY);
    expect(checksumValid(parseWire(`${body}&CHECKSUM=${sum}`), PAYGATE_TEST_KEY)).toBe(true);
    expect(checksumValid(parseWire(`${body}&CHECKSUM=deadbeef`), PAYGATE_TEST_KEY)).toBe(false);
    expect(checksumValid(parseWire(body), PAYGATE_TEST_KEY)).toBe(false);
  });

  it("builds query.trans and the process.trans checksum from the same three values", () => {
    const q = buildQueryFields("1", "REQ", "REF", "k");
    expect(q.at(-1)?.[1]).toBe(checksumOf(["1", "REQ", "REF"], "k"));
    expect(processChecksum("1", "REQ", "REF", "k")).toBe(q.at(-1)?.[1]);
  });

  it("maps PayGate's transaction statuses", () => {
    expect(mapTransactionStatus("1")).toBe("paid");
    expect(mapTransactionStatus("2")).toBe("failed");
    expect(mapTransactionStatus("4")).toBe("failed");
    expect(mapTransactionStatus("0")).toBe("pending");
    expect(mapTransactionStatus("5")).toBe("pending");
    expect(mapTransactionStatus(undefined)).toBe("pending");
  });

  it("keeps only the allow-listed fields for the payment row", () => {
    const kept = keepFields(parseWire("PAY_REQUEST_ID=R&TRANSACTION_STATUS=1&AUTH_CODE=6P3RSA&AMOUNT=530000&CURRENCY=BWP&CHECKSUM=x&USER1=secret-ish"));
    expect(kept).toEqual({ PAY_REQUEST_ID: "R", TRANSACTION_STATUS: "1", AUTH_CODE: "6P3RSA", AMOUNT: "530000", CURRENCY: "BWP" });
  });

  it("formats the transaction date in UTC", () => {
    expect(paygateDate(new Date("2026-09-07T17:05:09Z"))).toBe("2026-09-07 17:05:09");
  });
});
