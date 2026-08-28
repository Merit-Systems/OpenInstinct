import { describe, expect, it } from "vitest";
import type { AccessScope } from "../lib/access-scope";
import { serializePaymentCard } from "../lib/manager/payment-card";
import {
  buildNativeAutofillPayload,
  nativeAutofillTokens,
} from "../lib/manager/server/kernel-native-autofill";
import {
  listAutofillSuggestions,
  materializeAutofillClaims,
  type AutofillVaultAdapter,
} from "../lib/manager/server/vault-autofill";
import { createVaultAutofillProvider } from "../lib/manager/server/vault-autofill-provider";

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

  it("builds Chromium card autofill parameters from vault claims", () => {
    expect(
      buildNativeAutofillPayload("payment", [
        claim("cc-name", "Grace Hopper"),
        claim("cc-number", "4111111111111111"),
        claim("cc-exp-month", "09"),
        claim("cc-exp-year", "2031"),
        claim("cc-csc", "321"),
      ])
    ).toEqual({
      card: {
        cvc: "321",
        expiryMonth: "09",
        expiryYear: "2031",
        name: "Grace Hopper",
        number: "4111111111111111",
      },
    });
    expect(nativeAutofillTokens.payment).toContain("cc-exp-month");
  });

  it("builds Chromium address fields from structured vault claims", () => {
    expect(
      buildNativeAutofillPayload("address", [
        claim("name", "Ada Lovelace"),
        claim("address-line1", "12 St James's Square"),
        claim("address-line2", "Floor 2"),
        claim("address-level2", "London"),
        claim("address-level1", "London"),
        claim("postal-code", "SW1Y 4LB"),
        claim("country", "GB"),
      ])
    ).toEqual({
      address: {
        fields: [
          { name: "NAME_FULL", value: "Ada Lovelace" },
          {
            name: "ADDRESS_HOME_LINE1",
            value: "12 St James's Square",
          },
          { name: "ADDRESS_HOME_LINE2", value: "Floor 2" },
          { name: "ADDRESS_HOME_CITY", value: "London" },
          { name: "ADDRESS_HOME_STATE", value: "London" },
          { name: "ADDRESS_HOME_ZIP", value: "SW1Y 4LB" },
          { name: "ADDRESS_HOME_COUNTRY", value: "GB" },
        ],
      },
    });
  });

  it("builds a Chromium address from the current free-form vault value", () => {
    expect(
      buildNativeAutofillPayload("address", [
        claim("street-address", "12 St James's Square\nLondon SW1Y 4LB"),
      ])
    ).toEqual({
      address: {
        fields: [
          {
            name: "ADDRESS_HOME_STREET_ADDRESS",
            value: "12 St James's Square\nLondon SW1Y 4LB",
          },
        ],
      },
    });
  });
});

function claim(token: string, value: string) {
  return { token, value };
}
