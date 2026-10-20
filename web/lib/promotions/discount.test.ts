import { describe, expect, it } from "vitest";
import { discountLabelOf, discountPercentOf, isStaffDiscountCode } from "./discount";

describe("staff discount codes", () => {
  it("reads the percentage from the code", () => {
    expect(discountPercentOf("DISCOUNT-5")).toBe(5);
    expect(discountLabelOf("DISCOUNT-5")).toBe("5% off tuition");
    expect(isStaffDiscountCode("DISCOUNT-5")).toBe(true);
  });

  it("is not a scholarship, an ordinary deal, or a badly formed code", () => {
    for (const code of ["SCHOLARSHIP-10", "LAUNCH2027", "DISCOUNT-", "DISCOUNT-0", "DISCOUNT-100", "DISCOUNT-FIVE", "discount-5", null, undefined]) {
      expect(isStaffDiscountCode(code), String(code)).toBe(false);
      expect(discountLabelOf(code), String(code)).toBeNull();
    }
  });
});
