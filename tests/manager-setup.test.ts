import { describe, expect, it } from "vitest";
import {
  createManagerSetupUrl,
  isAllowedMutationOrigin,
  managerMutationSchema,
  managerSetupRequestSchema,
} from "../lib/manager";
import { serializePaymentCard } from "../lib/payment-card";
import {
  serializeContactVaultPayload,
  serializeLoginVaultPayload,
} from "../lib/vault-payload";

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
        account: "person@example.com",
        identifierType: "email",
        kind: "login",
        label: "Personal login",
        target: "vault",
      }).success
    ).toBe(false);
    expect(
      managerSetupRequestSchema.safeParse({
        kind: "login",
        label: "Personal login",
        target: "vault",
      }).success
    ).toBe(false);

    const url = new URL(
      createManagerSetupUrl("https://assistant.example.com", {
        identifierType: "email",
        kind: "login",
        label: "Personal login",
        target: "vault",
      })
    );

    expect(url.pathname).toBe("/vault");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      identifier_type: "email",
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

  it("requires versioned login and contact payloads", () => {
    expect(
      managerMutationSchema.safeParse({
        action: "vault.create",
        input: {
          account: "ada@example.com",
          kind: "login",
          label: "GitHub",
          secret: "plain password",
        },
      }).success
    ).toBe(false);
    expect(
      managerMutationSchema.safeParse({
        action: "vault.create",
        input: {
          account: "",
          kind: "login",
          label: "GitHub",
          secret: serializeLoginVaultPayload({
            authentication: { password: "secret", type: "password" },
            identifier: { type: "email", value: "ada@example.com" },
            kind: "login",
            version: 1,
          }),
        },
      }).success
    ).toBe(true);
    expect(
      managerMutationSchema.safeParse({
        action: "vault.create",
        input: {
          account: "",
          kind: "contact",
          label: "Checkout",
          secret: serializeContactVaultPayload({
            email: "ada@example.com",
            kind: "contact",
            phone: "+15555550100",
            version: 1,
          }),
        },
      }).success
    ).toBe(true);
  });

  it("allows only same-origin writes", () => {
    const request = {
      forwardedHost: "assistant.example.com",
      forwardedProto: "https",
      host: "internal.example:3000",
      origin: "https://assistant.example.com",
      requestUrl: "http://internal.example:3000/api/manager",
    };

    expect(isAllowedMutationOrigin(request)).toBe(true);
    expect(
      isAllowedMutationOrigin({
        ...request,
        origin: "https://attacker.example.com",
      })
    ).toBe(false);
  });
});
