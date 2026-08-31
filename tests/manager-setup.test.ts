import { describe, expect, it } from "vitest";
import {
  createManagerImportUrl,
  createManagerSetupUrl,
  managerMutationSchema,
  managerSetupRequestSchema,
  parseManagerSetupSearchParams,
} from "@/modules/manager";
import { isSameOrigin } from "@/lib/same-origin";
import { serializePaymentCard } from "@/modules/manager/payment-card";
import { parseChromePasswordsCsv } from "@/modules/manager/chrome-passwords";
import {
  serializeContactVaultPayload,
  serializeLoginVaultPayload,
} from "@/modules/manager/vault-payload";

describe("self-hosted manager", () => {
  it("builds a direct Chrome import URL", () => {
    expect(createManagerImportUrl("https://assistant.example.com")).toBe(
      "https://assistant.example.com/vault?import=chrome"
    );
  });

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
        origin: "https://auth.uber.com",
        target: "vault",
      }).success
    ).toBe(false);
    expect(
      managerSetupRequestSchema.safeParse({
        kind: "login",
        label: "Personal login",
        origin: "https://auth.uber.com",
        target: "vault",
      }).success
    ).toBe(false);

    const url = new URL(
      createManagerSetupUrl("https://assistant.example.com", {
        identifierType: "email",
        kind: "login",
        label: "Personal login",
        origin: "https://auth.uber.com",
        target: "vault",
      })
    );

    expect(url.pathname).toBe("/vault");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      identifier_type: "email",
      kind: "login",
      label: "Personal login",
      origin: "https://auth.uber.com",
      setup: "vault",
    });

    const addressUrl = new URL(
      createManagerSetupUrl("https://assistant.example.com", {
        kind: "address",
        label: "Home address",
        target: "vault",
      })
    );

    expect(addressUrl.pathname).toBe("/vault");
    expect(Object.fromEntries(addressUrl.searchParams)).toEqual({
      kind: "address",
      label: "Home address",
      setup: "vault",
    });
    expect(
      parseManagerSetupSearchParams(Object.fromEntries(addressUrl.searchParams))
    ).toEqual({
      data: {
        kind: "address",
        label: "Home address",
        target: "vault",
      },
      success: true,
    });
    expect(
      parseManagerSetupSearchParams({
        ...Object.fromEntries(addressUrl.searchParams),
        identifier_type: "email",
      }).success
    ).toBe(false);
  });

  it("accepts a selected gateway model", () => {
    expect(
      managerMutationSchema.safeParse({
        action: "model.select",
        modelId: "anthropic/claude-sonnet-4.5",
      }).success
    ).toBe(true);
  });

  it("accepts only login credentials in a bulk vault import", () => {
    expect(
      managerMutationSchema.safeParse({
        action: "vault.import",
        items: [
          {
            account: "",
            kind: "login",
            label: "GitHub",
            secret: serializeLoginVaultPayload({
              authentication: {
                password: "correct horse battery staple",
                type: "password",
              },
              identifier: { type: "email", value: "person@example.com" },
              kind: "login",
              origin: "https://github.com",
              version: 2,
            }),
          },
        ],
      }).success
    ).toBe(true);
    expect(
      managerMutationSchema.safeParse({
        action: "vault.import",
        items: [
          {
            account: "",
            kind: "phone",
            label: "Mobile",
            secret: "+1 555 555 5555",
          },
        ],
      }).success
    ).toBe(false);
  });

  it("normalizes Chrome CSV rows into origin-bound vault logins", () => {
    const result = parseChromePasswordsCsv(
      '\uFEFFname,url,username,password,note\r\nGitHub,https://github.com,octo@example.com,"comma,quote""and\nnewline",ignored\r\n'
    );

    expect(result.skipped).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      account: "",
      kind: "login",
      label: "GitHub",
    });
    expect(JSON.parse(result.items[0]?.secret ?? "")).toEqual({
      authentication: {
        password: 'comma,quote"and\nnewline',
        type: "password",
      },
      identifier: { type: "email", value: "octo@example.com" },
      kind: "login",
      origin: "https://github.com",
      version: 2,
    });
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
            origin: "https://github.com",
            version: 2,
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
