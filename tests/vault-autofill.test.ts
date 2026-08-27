import type { ToolContext } from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultItemKind } from "../lib/manager";
import { serializePaymentCard } from "../lib/manager/payment-card";
import {
  serializeAddressVaultPayload,
  serializeContactVaultPayload,
  serializeLoginVaultPayload,
} from "../lib/manager/vault-payload";

const VAULT_ITEM_ID = "00000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  executePlaywright:
    vi.fn<
      (
        _sessionId: string,
        _input: { code: string; timeout_sec: number },
        _options: { signal?: AbortSignal }
      ) => Promise<{ success: boolean }>
    >(),
  readVaultItem: vi.fn<
    () => Promise<
      | {
          account: string;
          createdAt: string;
          id: string;
          kind: VaultItemKind;
          label: string;
          updatedAt: string;
        }
      | undefined
    >
  >(),
  readSecret: vi.fn<() => Promise<string | undefined>>(),
  requireOwnedBrowserSession: vi.fn<() => Promise<void>>(),
}));

vi.mock("@onkernel/sdk", () => ({
  default: class {
    readonly browsers = {
      playwright: { execute: mocks.executePlaywright },
    };
  },
}));

vi.mock("@/lib/manager/server/secret-store", () => ({
  readSecret: mocks.readSecret,
}));

vi.mock("@/db/services/vault", () => ({
  readVaultItem: mocks.readVaultItem,
}));

vi.mock("@/agent/extensions/kernel/browser-runtime", () => ({
  requireOwnedBrowserSession: mocks.requireOwnedBrowserSession,
}));

import fillFromVault from "../agent/tools/fill_from_vault";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.executePlaywright.mockResolvedValue({ success: true });
  mocks.readVaultItem.mockResolvedValue({
    account: "ada@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
    id: VAULT_ITEM_ID,
    kind: "login",
    label: "Primary login",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  mocks.readSecret.mockResolvedValue(
    serializeLoginVaultPayload({
      authentication: {
        password: "correct horse battery staple",
        type: "password",
      },
      identifier: { type: "email", value: "ada@example.com" },
      kind: "login",
      origin: "https://checkout.example",
      version: 2,
    })
  );
  mocks.requireOwnedBrowserSession.mockResolvedValue(undefined);
});

describe("vault browser autofill", () => {
  it("fills only the requested login values through the tool boundary", async () => {
    await expect(
      fillFromVault.execute(
        {
          browserSessionId: "browser-1",
          expectedOrigin: "https://checkout.example",
          fields: [{ field: "username", selector: "#username" }],
          vaultItemId: VAULT_ITEM_ID,
        },
        toolContext
      )
    ).resolves.toEqual({
      filledFields: ["username"],
      origin: "https://checkout.example",
      success: true,
    });

    const [sessionId, request, options] =
      mocks.executePlaywright.mock.calls[0] ?? [];
    expect(sessionId).toBe("browser-1");
    expect(request?.timeout_sec).toBe(30);
    expect(request?.code).toContain("ada@example.com");
    expect(request?.code).not.toContain("correct horse battery staple");
    expect(options?.signal).toBe(toolContext.abortSignal);
  });

  it("rejects a login outside its saved origin before calling Kernel", async () => {
    await expect(
      fillFromVault.execute(
        {
          browserSessionId: "browser-1",
          expectedOrigin: "https://attacker.example",
          fields: [{ field: "username", selector: "#username" }],
          vaultItemId: VAULT_ITEM_ID,
        },
        toolContext
      )
    ).rejects.toThrow("restricted to https://checkout.example");

    expect(mocks.executePlaywright).not.toHaveBeenCalled();
  });

  it("refuses legacy logins that have no saved origin", async () => {
    mocks.readSecret.mockResolvedValue(
      JSON.stringify({
        authentication: { password: "correct horse", type: "password" },
        identifier: { type: "email", value: "ada@example.com" },
        kind: "login",
        version: 1,
      })
    );

    await expect(
      fillFromVault.execute(
        {
          browserSessionId: "browser-1",
          expectedOrigin: "https://checkout.example",
          fields: [{ field: "username", selector: "#username" }],
          vaultItemId: VAULT_ITEM_ID,
        },
        toolContext
      )
    ).rejects.toThrow("not assigned to a website");

    expect(mocks.executePlaywright).not.toHaveBeenCalled();
  });

  it("resolves structured password and passwordless logins", async () => {
    mocks.readVaultItem.mockResolvedValue({
      account: "Phone · •••• 0100",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: VAULT_ITEM_ID,
      kind: "login",
      label: "Primary login",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mocks.readSecret.mockResolvedValue(
      serializeLoginVaultPayload({
        authentication: { password: "correct horse", type: "password" },
        identifier: { type: "phone", value: "+15555550100" },
        kind: "login",
        origin: "https://checkout.example",
        version: 2,
      })
    );

    await expect(
      fillFromVault.execute(
        {
          browserSessionId: "browser-1",
          expectedOrigin: "https://checkout.example",
          fields: [
            { field: "username", selector: "#username" },
            { field: "phone", selector: "#phone" },
            { field: "password", selector: "#password" },
          ],
          vaultItemId: VAULT_ITEM_ID,
        },
        toolContext
      )
    ).resolves.toMatchObject({
      filledFields: ["username", "phone", "password"],
      success: true,
    });

    mocks.readSecret.mockResolvedValue(
      serializeLoginVaultPayload({
        authentication: { type: "email_otp" },
        identifier: { type: "email", value: "ada@example.com" },
        kind: "login",
        origin: "https://checkout.example",
        version: 2,
      })
    );
    await expect(
      fillFromVault.execute(
        {
          browserSessionId: "browser-1",
          expectedOrigin: "https://checkout.example",
          fields: [{ field: "password", selector: "#password" }],
          vaultItemId: VAULT_ITEM_ID,
        },
        toolContext
      )
    ).rejects.toThrow("does not provide password");
  });

  it("resolves structured checkout profiles field by field", async () => {
    mocks.readVaultItem.mockResolvedValue({
      account: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: VAULT_ITEM_ID,
      kind: "address",
      label: "Home",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mocks.readSecret.mockResolvedValue(
      serializeAddressVaultPayload({
        city: "London",
        countryCode: "GB",
        kind: "address",
        line1: "12 St James's Square",
        postalCode: "SW1Y 4LB",
        recipientName: "Ada Lovelace",
        region: "London",
        version: 1,
      })
    );

    await expect(
      fillFromVault.execute(
        {
          browserSessionId: "browser-1",
          expectedOrigin: "https://checkout.example",
          fields: [
            { field: "full_name", selector: "#name" },
            { field: "address_line1", selector: "#address" },
            { field: "address_city", selector: "#city" },
            { field: "address_postal_code", selector: "#postal-code" },
          ],
          vaultItemId: VAULT_ITEM_ID,
        },
        toolContext
      )
    ).resolves.toMatchObject({
      filledFields: [
        "full_name",
        "address_line1",
        "address_city",
        "address_postal_code",
      ],
      success: true,
    });

    mocks.readVaultItem.mockResolvedValue({
      account: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: VAULT_ITEM_ID,
      kind: "contact",
      label: "Checkout",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mocks.readSecret.mockResolvedValue(
      serializeContactVaultPayload({
        email: "ada@example.com",
        fullName: "Ada Lovelace",
        kind: "contact",
        phone: "+442079460000",
        version: 1,
      })
    );

    await expect(
      fillFromVault.execute(
        {
          browserSessionId: "browser-1",
          expectedOrigin: "https://checkout.example",
          fields: [
            { field: "full_name", selector: "#name" },
            { field: "email", selector: "#email" },
            { field: "phone", selector: "#phone" },
          ],
          vaultItemId: VAULT_ITEM_ID,
        },
        toolContext
      )
    ).resolves.toMatchObject({
      filledFields: ["full_name", "email", "phone"],
      success: true,
    });
  });

  it("formats payment fields and uses native card autofill with a keyboard fallback", async () => {
    mocks.readVaultItem.mockResolvedValue({
      account: "Visa 4242",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: VAULT_ITEM_ID,
      kind: "payment",
      label: "Primary card",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    mocks.readSecret.mockResolvedValue(
      serializePaymentCard({
        billingPostalCode: "11217",
        cardholderName: "Ada Lovelace",
        expirationMonth: 3,
        expirationYear: 2031,
        kind: "payment-card",
        number: "4242424242424242",
        securityCode: "123",
        version: 1,
      })
    );

    await expect(
      fillFromVault.execute(
        {
          browserSessionId: "browser-1",
          expectedOrigin: "https://checkout.example",
          fields: [
            { field: "cardholder_name", selector: "#cardholder-name" },
            { field: "card_number", selector: "#card-number" },
            { field: "expiration", selector: "#expiration" },
            { field: "cvc", selector: "#cvc" },
            { field: "billing_postal_code", selector: "#postal-code" },
          ],
          vaultItemId: VAULT_ITEM_ID,
        },
        toolContext
      )
    ).resolves.toEqual({
      filledFields: [
        "cardholder_name",
        "card_number",
        "expiration",
        "cvc",
        "billing_postal_code",
      ],
      origin: "https://checkout.example",
      success: true,
    });

    const code = mocks.executePlaywright.mock.calls[0]?.[1].code;
    expect(code).toMatch(
      /03\/31[\s\S]*context\.newCDPSession\(page\)[\s\S]*Autofill\.trigger[\s\S]*pressSequentially/
    );
  });

  it("rejects fields that do not belong to the selected vault item", async () => {
    await expect(
      fillFromVault.execute(
        {
          browserSessionId: "browser-1",
          expectedOrigin: "https://checkout.example",
          fields: [{ field: "card_number", selector: "#card-number" }],
          vaultItemId: VAULT_ITEM_ID,
        },
        toolContext
      )
    ).rejects.toThrow("does not provide card_number");
    expect(mocks.executePlaywright).not.toHaveBeenCalled();
  });
});

const principal = {
  attributes: { workspaceId: "workspace:user-1" },
  authenticator: "test",
  principalId: "user-1",
  principalType: "user",
};

const toolContext = {
  abortSignal: new AbortController().signal,
  callId: "call-1",
  async getSandbox() {
    throw new Error("No sandbox is needed for this tool test.");
  },
  getSkill() {
    throw new Error("No skill is needed for this tool test.");
  },
  async getToken() {
    throw new Error("No token is needed for this tool test.");
  },
  requireAuth() {
    throw new Error("No authorization is needed for this tool test.");
  },
  session: {
    auth: { current: principal, initiator: principal },
    id: "session-1",
    turn: { id: "turn-1", sequence: 0 },
  },
  toolName: "fill_from_vault",
} satisfies ToolContext;
