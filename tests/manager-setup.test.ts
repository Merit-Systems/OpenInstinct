import { describe, expect, it } from "vitest";
import {
  createManagerSetupUrl,
  managerMutationSchema,
  managerSetupRequestSchema,
} from "../lib/manager";
import { isSameOrigin } from "../app/_lib/server/same-origin";
import { serializePaymentCard } from "../lib/manager/payment-card";

describe("self-hosted manager", () => {
  it("builds a vault form URL without accepting a secret", () => {
    expect(
      managerSetupRequestSchema.safeParse({
        kind: "login",
        secret: "must-not-enter-a-url",
        target: "vault",
      }).success
    ).toBe(false);
    expect(
      managerSetupRequestSchema.safeParse({
        kind: "identity",
        target: "vault",
      }).success
    ).toBe(false);
    expect(
      managerSetupRequestSchema.safeParse({
        email: "person@example.com",
        kind: "login",
        target: "vault",
      }).success
    ).toBe(false);

    const url = new URL(
      createManagerSetupUrl("https://assistant.example.com", {
        account: "person@example.com",
        kind: "login",
        label: "Personal login",
        target: "vault",
      })
    );

    expect(url.pathname).toBe("/vault");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      account: "person@example.com",
      kind: "login",
      label: "Personal login",
      setup: "vault",
    });
  });

  it("accepts a selected gateway model", () => {
    expect(
      managerMutationSchema.safeParse({
        action: "model.select",
        modelId: "anthropic/claude-sonnet-4.5",
      }).success
    ).toBe(true);
  });

  it("does not expose removed runtime mutations", () => {
    expect(
      managerMutationSchema.safeParse({
        action: "connection.create",
        input: {
          account: "qwen3.5:27b",
          endpoint: "http://127.0.0.1:11434/v1",
          label: "Local model",
          provider: "local-model",
          secret: "",
        },
      }).success
    ).toBe(false);
  });

  it("requires complete structured payment-card details", () => {
    const mutation = {
      action: "vault.create",
      input: {
        account: "Visa · •••• 4242",
        kind: "payment",
        label: "Personal",
        secret: "4242 4242 4242 4242",
      },
    };

    expect(managerMutationSchema.safeParse(mutation).success).toBe(false);
    expect(
      managerMutationSchema.safeParse({
        ...mutation,
        input: {
          ...mutation.input,
          secret: serializePaymentCard({
            billingPostalCode: "11217",
            cardholderName: "Ada Lovelace",
            expirationMonth: 12,
            expirationYear: 2030,
            kind: "payment-card",
            number: "4242424242424242",
            securityCode: "123",
            version: 1,
          }),
        },
      }).success
    ).toBe(true);
  });

  it("allows only same-origin writes", () => {
    const headers = {
      host: "internal.example:3000",
      origin: "https://assistant.example.com",
      "x-forwarded-host": "assistant.example.com",
      "x-forwarded-proto": "https",
    };

    expect(
      isSameOrigin(
        new Request("http://internal.example:3000/api/manager", { headers })
      )
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request("http://internal.example:3000/api/manager", {
          headers: { ...headers, origin: "https://attacker.example.com" },
        })
      )
    ).toBe(false);
  });
});
