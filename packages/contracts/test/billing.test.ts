import { describe, expect, it } from "vitest";
import { ChangePlanSchema, CheckoutSchema, ERROR_CHARGE, ERROR_CODES } from "../src/index.ts";

describe("billing contracts", () => {
  it("validate checkout requests", () => {
    expect(CheckoutSchema.safeParse({ productKey: "pack60" }).success).toBe(true);
    expect(
      CheckoutSchema.safeParse({
        productKey: "plus_year",
        returnPath: "/unblur-photo",
        clientId: "123.456",
      }).success,
    ).toBe(true);
    expect(CheckoutSchema.safeParse({ productKey: "" }).success).toBe(false);
    expect(CheckoutSchema.safeParse({ productKey: "x", clientId: "a b" }).success).toBe(false);
    expect(ChangePlanSchema.safeParse({ productKey: "max_month" }).success).toBe(true);
  });

  it("have the billing error codes", () => {
    for (const code of ["SUBSCRIPTION_ACTIVE", "PAYMENTS_UNAVAILABLE"] as const) {
      expect(ERROR_CODES).toContain(code);
      expect(ERROR_CHARGE[code]).toBe("none");
    }
  });
});
