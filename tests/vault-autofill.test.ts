import { describe, expect, it } from "vitest";
import { serializePaymentCard } from "../lib/payment-card";
import { resolveVaultAutofillValues } from "../lib/vault-autofill";

describe("vault browser autofill", () => {
  it("resolves a login without returning unrequested values", () => {
    expect(
      resolveVaultAutofillValues(
        { account: "ada@example.com", kind: "login" },
        "correct horse battery staple",
        ["username"]
      )
    ).toEqual([{ field: "username", value: "ada@example.com" }]);
  });

  it("formats structured payment-card fields for browser forms", () => {
    const secret = serializePaymentCard({
      billingPostalCode: "11217",
      cardholderName: "Ada Lovelace",
      expirationMonth: 3,
      expirationYear: 2031,
      kind: "payment-card",
      number: "4242424242424242",
      securityCode: "123",
      version: 1,
    });

    expect(
      resolveVaultAutofillValues(
        { account: "Visa 4242", kind: "payment" },
        secret,
        ["expiration", "cvc", "billing_postal_code"]
      )
    ).toEqual([
      { field: "expiration", value: "03/31" },
      { field: "cvc", value: "123" },
      { field: "billing_postal_code", value: "11217" },
    ]);
  });

  it("rejects fields that do not belong to the selected vault item", () => {
    expect(() =>
      resolveVaultAutofillValues(
        { account: "ada@example.com", kind: "login" },
        "secret-value",
        ["card_number"]
      )
    ).toThrow("does not provide card_number");
  });
});
