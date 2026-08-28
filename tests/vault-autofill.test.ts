import { describe, expect, it } from "vitest";
import { classifyAutofillField } from "../browser-extension/lib/field-detector";
import { isAutofillFrame } from "../browser-extension/lib/frame-policy";
import type { AccessScope } from "../lib/access-scope";
import {
  listAutofillSuggestions,
  materializeAutofillClaims,
  type AutofillVaultAdapter,
} from "../lib/server/vault-autofill";
import { extensionRuntimeCode } from "../lib/server/vault-extension-autofill";
import { createVaultAutofillProvider } from "../lib/server/vault-autofill-provider";
import { serializePaymentCard } from "../lib/payment-card";
import { vaultAutofillCommandSchema } from "../lib/vault-autofill-protocol";

const scope: AccessScope = {
  userId: "user-1",
  workspaceId: "workspace-1",
};

const paymentSurface = {
  fields: [
    { score: 100, token: "cc-number" },
    { score: 100, token: "cc-exp" },
  ],
  id: "payment-card",
  kind: "payment-card" as const,
};

describe("vault browser autofill", () => {
  it("uses the encrypted local vault instead of a development card fixture", async () => {
    const card = {
      account: "Visa · •••• 1111",
      createdAt: "2026-08-27T00:00:00.000Z",
      id: "real-card-id",
      kind: "payment" as const,
      label: "Travel card",
      updatedAt: "2026-08-27T00:00:00.000Z",
    };
    const provider = createVaultAutofillProvider({
      async hasSecret() {
        return true;
      },
      async listVaultItems() {
        return [card];
      },
      async readSecret() {
        return serializePaymentCard({
          billingPostalCode: "10001",
          cardholderName: "Grace Hopper",
          expirationMonth: 9,
          expirationYear: 2031,
          kind: "payment-card",
          number: "4111111111111111",
          securityCode: "321",
          version: 1,
        });
      },
      async readVaultItem() {
        return card;
      },
    });

    await expect(
      provider.listSuggestions(
        scope,
        "https://merchant.example",
        paymentSurface
      )
    ).resolves.toEqual([
      {
        candidateId: "real-card-id",
        label: "Travel card",
        matchReason: "Saved payment card",
        summary: "Visa · •••• 1111",
      },
    ]);

    const claims = await provider.materializeClaims(scope, "real-card-id", {
      availableTokens: new Set([
        "cc-name",
        "cc-number",
        "cc-exp",
        "cc-csc",
        "postal-code",
      ]),
      origin: "https://merchant.example",
      surface: paymentSurface,
    });
    expect(
      Object.fromEntries(claims.map(({ token, value }) => [token, value]))
    ).toEqual({
      "cc-csc": "321",
      "cc-exp": "09/31",
      "cc-name": "Grace Hopper",
      "cc-number": "4111111111111111",
      "postal-code": "10001",
    });
  });

  it("lets a vault-owned adapter supply masked suggestions and claims", async () => {
    const adapter: AutofillVaultAdapter = {
      async listSuggestions(_scope, origin, surface) {
        expect(origin).toBe("https://merchant.example");
        expect(surface.kind).toBe("payment-card");
        return [
          {
            candidateId: "opaque-card",
            label: "Personal Visa",
            matchReason: "Preferred payment method",
            summary: "Visa •••• 4242",
          },
        ];
      },
      async materializeClaims(_scope, candidateId, target) {
        expect(candidateId).toBe("opaque-card");
        expect(target.surface.kind).toBe("payment-card");
        return [
          {
            id: "84e90f49-68d0-45ba-a183-3ca18ef087dc",
            token: "cc-number",
            value: "4242424242424242",
          },
        ];
      },
    };

    await expect(
      listAutofillSuggestions(
        scope,
        "https://merchant.example",
        paymentSurface,
        adapter
      )
    ).resolves.toEqual([
      {
        candidateId: "opaque-card",
        label: "Personal Visa",
        matchReason: "Preferred payment method",
        summary: "Visa •••• 4242",
      },
    ]);
    await expect(
      materializeAutofillClaims(
        scope,
        "opaque-card",
        {
          availableTokens: new Set(["cc-number", "cc-exp"]),
          origin: "https://merchant.example",
          surface: paymentSurface,
        },
        adapter
      )
    ).resolves.toEqual([
      {
        id: "84e90f49-68d0-45ba-a183-3ca18ef087dc",
        token: "cc-number",
        value: "4242424242424242",
      },
    ]);
  });

  it("accepts protocol tokens without defining a vault-field enum", () => {
    const now = Date.now();
    expect(
      vaultAutofillCommandSchema.parse({
        claims: [
          {
            id: "84e90f49-68d0-45ba-a183-3ca18ef087dc",
            token: "future-browser-token",
            value: "private value",
          },
        ],
        expectedOrigin: "https://merchant.example",
        expiresAt: now + 30_000,
        issuedAt: now,
        nonce: "a-unique-request-nonce",
        surfaceId: "future-surface",
        version: 1,
      }).claims[0]?.token
    ).toBe("future-browser-token");
  });

  it("prefers browser-standard autocomplete semantics", () => {
    expect(
      classifyAutofillField({
        autocomplete: "billing cc-number",
        label: "",
        name: "opaque-provider-field",
        type: "tel",
      })
    ).toEqual({ kind: "payment-card", score: 100, token: "cc-number" });
    expect(
      classifyAutofillField({
        autocomplete: "billing cc-exp-month",
        label: "",
        name: "month",
        type: "text",
      })
    ).toEqual({ kind: "payment-card", score: 100, token: "cc-exp-month" });
  });

  it("accepts detected autofill surfaces from any reachable frame origin", () => {
    expect(
      isAutofillFrame({
        origin: "https://js.globalpay.com",
        surfaces: [paymentSurface],
      })
    ).toBe(true);
    expect(
      isAutofillFrame({
        origin: "https://unknown-payment-provider.example",
        surfaces: [paymentSurface],
      })
    ).toBe(true);
    expect(
      isAutofillFrame({
        origin: "https://analytics.example",
        surfaces: [],
      })
    ).toBe(false);
  });

  it("falls back to labels without model-authored selectors", () => {
    expect(
      classifyAutofillField({
        autocomplete: "off",
        label: "Security code (CVV)",
        name: "secure-field",
        type: "text",
      })
    ).toEqual({ kind: "payment-card", score: 70, token: "cc-csc" });
    expect(
      classifyAutofillField({
        autocomplete: "",
        label: "MM/YY",
        name: "cardExpiry cc-cardExpiry",
        type: "text",
      })
    ).toEqual({ kind: "payment-card", score: 70, token: "cc-exp" });
  });

  it("sends only an encrypted envelope through Kernel Playwright", () => {
    const code = extensionRuntimeCode("fill", "encrypted-envelope");

    expect(code).toContain('cdpSession.send("Runtime.enable")');
    expect(code).toContain("vaultAutofillContentRuntime");
    expect(code).toContain("encrypted-envelope");
    expect(code).not.toContain("4242424242424242");
    expect(code).not.toContain("context.serviceWorkers()");
  });

  it("timestamps commands with the browser clock", () => {
    const code = extensionRuntimeCode("getPublicKey");

    expect(code).toContain("browserNow: Date.now()");
    expect(code).toContain("publicKey");
  });
});
