import { describe, expect, it } from "vitest";
import { classifyAutofillField } from "../browser-extension/lib/field-detector";
import {
  fillAutofillClaims,
  fillCandidates,
} from "../browser-extension/lib/fill-engine";
import { permittedFrameInspection } from "../browser-extension/lib/frame-policy";
import type { AccessScope } from "../lib/access-scope";
import type { VaultItemKind } from "../lib/manager";
import { serializePaymentCard } from "../lib/manager/payment-card";
import {
  listAutofillSuggestions,
  materializeAutofillClaims,
  type AutofillVaultAdapter,
} from "../lib/manager/server/vault-autofill";
import { createVaultAutofillProvider } from "../lib/manager/server/vault-autofill-provider";
import { extensionRuntimeCode } from "../lib/manager/server/vault-extension-autofill";
import { vaultAutofillCommandSchema } from "../lib/manager/vault-autofill-protocol";
import {
  serializeAddressVaultPayload,
  serializeContactVaultPayload,
  serializeLoginVaultPayload,
} from "../lib/manager/vault-payload";

const scope: AccessScope = {
  userId: "user-1",
  workspaceId: "workspace-1",
};

const paymentSurface = surface("payment-card", ["cc-number", "cc-exp"]);
const credentialsSurface = surface("credentials", [
  "username",
  "current-password",
]);
const contactSurface = surface("contact", ["email", "tel"]);
const addressSurface = surface("postal-address", [
  "address-line1",
  "address-line2",
  "address-level2",
  "address-level1",
  "postal-code",
  "country",
]);

describe("vault browser autofill", () => {
  it("uses the encrypted local vault instead of a development card fixture", async () => {
    const card = vaultItem("payment", "Travel card", "Visa · •••• 1111");
    const provider = providerFor(
      card,
      serializePaymentCard({
        billingPostalCode: "10001",
        cardholderName: "Grace Hopper",
        expirationMonth: 9,
        expirationYear: 2031,
        kind: "payment-card",
        number: "4111111111111111",
        securityCode: "321",
        version: 1,
      })
    );

    await expect(
      provider.listSuggestions(
        scope,
        "https://merchant.example",
        paymentSurface
      )
    ).resolves.toEqual([
      {
        candidateId: card.id,
        label: "Travel card",
        matchReason: "Saved payment card",
        summary: "Visa · •••• 1111",
      },
    ]);

    const claims = await provider.materializeClaims(scope, card.id, {
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
    expect(claimValues(claims)).toEqual({
      "cc-csc": "321",
      "cc-exp": "09/31",
      "cc-name": "Grace Hopper",
      "cc-number": "4111111111111111",
      "postal-code": "10001",
    });
  });

  it("suggests and materializes structured logins only at their bound origin", async () => {
    const login = vaultItem(
      "login",
      "Primary login",
      "checkout.example · a•••@example.com"
    );
    const provider = providerFor(
      login,
      serializeLoginVaultPayload({
        authentication: { password: "correct horse", type: "password" },
        identifier: { type: "email", value: "ada@example.com" },
        kind: "login",
        origin: "https://checkout.example",
        version: 2,
      })
    );

    await expect(
      provider.listSuggestions(
        scope,
        "https://checkout.example",
        credentialsSurface
      )
    ).resolves.toEqual([
      expect.objectContaining({
        candidateId: login.id,
        summary: "checkout.example · a•••@example.com",
      }),
    ]);
    await expect(
      provider.listSuggestions(
        scope,
        "https://attacker.example",
        credentialsSurface
      )
    ).resolves.toEqual([]);

    const claims = await provider.materializeClaims(scope, login.id, {
      availableTokens: new Set(["username", "current-password"]),
      origin: "https://checkout.example",
      surface: credentialsSurface,
    });
    expect(claimValues(claims)).toEqual({
      "current-password": "correct horse",
      username: "ada@example.com",
    });

    await expect(
      provider.materializeClaims(scope, login.id, {
        availableTokens: new Set(["username"]),
        origin: "https://attacker.example",
        surface: credentialsSurface,
      })
    ).rejects.toThrow("restricted to https://checkout.example");
  });

  it("fills passwordless identifiers but never invents an OTP claim", async () => {
    const login = vaultItem("login", "Email code", "a•••@example.com");
    const provider = providerFor(
      login,
      serializeLoginVaultPayload({
        authentication: { type: "email_otp" },
        identifier: { type: "email", value: "ada@example.com" },
        kind: "login",
        origin: "https://checkout.example",
        version: 2,
      })
    );

    await expect(
      provider.listSuggestions(
        scope,
        "https://checkout.example",
        contactSurface
      )
    ).resolves.toHaveLength(1);
    const claims = await provider.materializeClaims(scope, login.id, {
      availableTokens: new Set(["email", "one-time-code"]),
      origin: "https://checkout.example",
      surface: contactSurface,
    });
    expect(claimValues(claims)).toEqual({ email: "ada@example.com" });
  });

  it("fails closed for legacy logins without an origin", async () => {
    const login = vaultItem("login", "Legacy", "a•••@example.com");
    const provider = providerFor(
      login,
      JSON.stringify({
        authentication: { password: "correct horse", type: "password" },
        identifier: { type: "email", value: "ada@example.com" },
        kind: "login",
        version: 1,
      })
    );

    await expect(
      provider.listSuggestions(
        scope,
        "https://checkout.example",
        credentialsSurface
      )
    ).resolves.toEqual([]);
    await expect(
      provider.materializeClaims(scope, login.id, {
        availableTokens: new Set(["username"]),
        origin: "https://checkout.example",
        surface: credentialsSurface,
      })
    ).rejects.toThrow("not assigned to a website");
  });

  it("maps structured addresses and contacts to browser-standard tokens", async () => {
    const address = vaultItem("address", "Home", "");
    const addressProvider = providerFor(
      address,
      serializeAddressVaultPayload({
        city: "London",
        countryCode: "GB",
        kind: "address",
        line1: "12 St James's Square",
        line2: "Floor 2",
        postalCode: "SW1Y 4LB",
        recipientName: "Ada Lovelace",
        region: "London",
        version: 1,
      })
    );
    const addressClaims = await addressProvider.materializeClaims(
      scope,
      address.id,
      {
        availableTokens: new Set(
          addressSurface.fields.map(({ token }) => token)
        ),
        origin: "https://merchant.example",
        surface: addressSurface,
      }
    );
    expect(claimValues(addressClaims)).toEqual({
      "address-level1": "London",
      "address-level2": "London",
      "address-line1": "12 St James's Square",
      "address-line2": "Floor 2",
      country: "GB",
      "postal-code": "SW1Y 4LB",
    });

    const contact = vaultItem("contact", "Checkout", "");
    const contactProvider = providerFor(
      contact,
      serializeContactVaultPayload({
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        kind: "contact",
        phone: "+442079460000",
        version: 1,
      })
    );
    const contactClaims = await contactProvider.materializeClaims(
      scope,
      contact.id,
      {
        availableTokens: new Set(["email", "tel"]),
        origin: "https://merchant.example",
        surface: contactSurface,
      }
    );
    expect(claimValues(contactClaims)).toEqual({
      email: "ada@example.com",
      tel: "+442079460000",
    });
  });

  it("lets a vault-owned adapter supply masked suggestions and claims", async () => {
    const adapter: AutofillVaultAdapter = {
      async listSuggestions(_scope, origin, detectedSurface) {
        expect(origin).toBe("https://merchant.example");
        expect(detectedSurface.kind).toBe("payment-card");
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
        autocomplete: "shipping address-level2",
        label: "",
        name: "city",
        type: "text",
      })
    ).toEqual({ kind: "postal-address", score: 100, token: "address-level2" });
    expect(
      classifyAutofillField({
        autocomplete: "country",
        label: "",
        name: "country",
        type: "text",
      })
    ).toEqual({ kind: "postal-address", score: 100, token: "country" });
  });

  it("limits cross-origin autofill to hosted payment surfaces", () => {
    expect(
      permittedFrameInspection("https://merchant.example", {
        origin: "https://js.globalpay.com",
        surfaces: [paymentSurface, credentialsSurface],
      })
    ).toEqual({
      origin: "https://js.globalpay.com",
      surfaces: [paymentSurface],
    });
    expect(
      permittedFrameInspection("https://merchant.example", {
        origin: "https://unknown-payment-provider.example",
        surfaces: [paymentSurface],
      })
    ).toEqual({
      origin: "https://unknown-payment-provider.example",
      surfaces: [paymentSurface],
    });
    expect(
      permittedFrameInspection("https://merchant.example", {
        origin: "https://embedded-login.example",
        surfaces: [credentialsSurface],
      })
    ).toBeNull();
    expect(
      permittedFrameInspection("https://merchant.example", {
        origin: "https://analytics.example",
        surfaces: [],
      })
    ).toBeNull();
  });

  it("keeps every detected surface in same-origin frames", () => {
    const inspection = {
      origin: "https://merchant.example",
      surfaces: [paymentSurface, credentialsSurface, contactSurface],
    };

    expect(
      permittedFrameInspection("https://merchant.example", inspection)
    ).toBe(inspection);
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
        label: "Apartment or suite",
        name: "address-line-2",
        type: "text",
      })
    ).toEqual({ kind: "postal-address", score: 70, token: "address-line2" });
  });

  it("lets masked expiry controls own slash formatting", () => {
    expect(fillCandidates("09/31", "cc-exp")).toEqual(["09/31", "0931"]);
    expect(fillCandidates("Grace Hopper", "cc-name")).toEqual(["Grace Hopper"]);
  });

  it("rejects a frame that navigated after autofill inspection", async () => {
    await expect(
      fillAutofillClaims(
        { claims: [], expectedOrigin: "https://checkout.example" },
        () => "https://attacker.example"
      )
    ).rejects.toThrow("no longer matches the approved origin");
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

function surface(kind: string, tokens: readonly string[]) {
  return {
    fields: tokens.map((token) => ({ score: 100, token })),
    id: kind,
    kind,
  };
}

function vaultItem(kind: VaultItemKind, label: string, account: string) {
  return {
    account,
    createdAt: "2026-08-27T00:00:00.000Z",
    id: `vault-${kind}`,
    kind,
    label,
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

function providerFor(item: ReturnType<typeof vaultItem>, secret: string) {
  return createVaultAutofillProvider({
    async hasSecret() {
      return true;
    },
    async listVaultItems() {
      return [item];
    },
    async readSecret() {
      return secret;
    },
    async readVaultItem() {
      return item;
    },
  });
}

function claimValues(
  claims: readonly { readonly token: string; readonly value: string }[]
) {
  return Object.fromEntries(claims.map(({ token, value }) => [token, value]));
}
