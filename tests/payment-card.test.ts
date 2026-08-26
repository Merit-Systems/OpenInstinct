import { describe, expect, it } from "vitest";
import {
  paymentCardBrand,
  paymentCardSecretStringSchema,
  serializePaymentCard,
} from "../lib/payment-card";

describe("payment card vault values", () => {
  it("serializes a complete structured card secret", () => {
    const secret = serializePaymentCard({
      billingPostalCode: "11217",
      cardholderName: "Ada Lovelace",
      expirationMonth: 12,
      expirationYear: 2030,
      kind: "payment-card",
      number: "4242424242424242",
      securityCode: "123",
      version: 1,
    });

    expect(paymentCardSecretStringSchema.safeParse(secret).success).toBe(true);
    expect(JSON.parse(secret)).toEqual(
      expect.objectContaining({
        billingPostalCode: "11217",
        cardholderName: "Ada Lovelace",
        number: "4242424242424242",
      })
    );
  });

  it("identifies common card networks without storing extra metadata", () => {
    expect(paymentCardBrand("4242 4242 4242 4242")).toBe("Visa");
    expect(paymentCardBrand("378282246310005")).toBe("American Express");
  });
});
