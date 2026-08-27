import { listVaultItems, readVaultItem } from "@/db/services/vault";
import { parsePaymentCardSecret } from "../payment-card";
import type { DetectedAutofillSurface } from "../vault-autofill-protocol";
import { hasSecret, readSecret } from "./secret-store";
import type { AutofillVaultAdapter } from "./vault-autofill";

interface VaultAutofillCodec {
  readonly claims: (
    item: NonNullable<Awaited<ReturnType<typeof readVaultItem>>>,
    secret: string
  ) => ReadonlyMap<string, string>;
  readonly matchReason: string;
  readonly surfaceKind: string;
  readonly tokens: readonly string[];
  readonly vaultKind: string;
}

const codecs = [
  {
    claims(_item, secret) {
      const card = parsePaymentCardSecret(secret);
      return new Map([
        ["cc-name", card.cardholderName],
        ["cc-number", card.number],
        [
          "cc-exp",
          `${String(card.expirationMonth).padStart(2, "0")}/${String(card.expirationYear).slice(-2)}`,
        ],
        ["cc-exp-month", String(card.expirationMonth).padStart(2, "0")],
        ["cc-exp-year", String(card.expirationYear)],
        ["cc-csc", card.securityCode],
        ["postal-code", card.billingPostalCode],
      ]);
    },
    matchReason: "Saved payment card",
    surfaceKind: "payment-card",
    tokens: [
      "cc-name",
      "cc-number",
      "cc-exp",
      "cc-exp-month",
      "cc-exp-year",
      "cc-csc",
      "postal-code",
    ],
    vaultKind: "payment",
  },
  {
    claims(item, secret) {
      return new Map([
        ["username", item.account],
        ["current-password", secret],
      ]);
    },
    matchReason: "Saved login",
    surfaceKind: "credentials",
    tokens: ["username", "current-password"],
    vaultKind: "login",
  },
  {
    claims(_item, secret) {
      return new Map([["street-address", secret]]);
    },
    matchReason: "Saved address",
    surfaceKind: "postal-address",
    tokens: ["street-address"],
    vaultKind: "address",
  },
  {
    claims(_item, secret) {
      return new Map([["tel", secret]]);
    },
    matchReason: "Saved phone number",
    surfaceKind: "contact",
    tokens: ["tel"],
    vaultKind: "phone",
  },
] satisfies readonly VaultAutofillCodec[];

export function createVaultAutofillProvider(
  dependencies: {
    readonly hasSecret?: typeof hasSecret;
    readonly listVaultItems?: typeof listVaultItems;
    readonly readSecret?: typeof readSecret;
    readonly readVaultItem?: typeof readVaultItem;
  } = {}
): AutofillVaultAdapter {
  const stores = {
    hasSecret: dependencies.hasSecret ?? hasSecret,
    listVaultItems: dependencies.listVaultItems ?? listVaultItems,
    readSecret: dependencies.readSecret ?? readSecret,
    readVaultItem: dependencies.readVaultItem ?? readVaultItem,
  };

  return {
    async listSuggestions(scope, _origin, surface) {
      const compatibleCodecs = codecsForSurface(surface);
      if (compatibleCodecs.length === 0) return [];

      const items = await stores.listVaultItems(scope);
      const compatibleItems = items.filter((item) =>
        compatibleCodecs.some(
          (codec) =>
            codec.vaultKind === item.kind &&
            surface.fields.some(({ token }) => codec.tokens.includes(token))
        )
      );
      const availability = await Promise.all(
        compatibleItems.map((item) =>
          stores.hasSecret({ id: item.id, namespace: "vault", scope })
        )
      );

      return compatibleItems.flatMap((item, index) => {
        if (!availability[index]) return [];
        const codec = compatibleCodecs.find(
          (candidate) => candidate.vaultKind === item.kind
        );
        if (!codec) return [];
        return [
          {
            candidateId: item.id,
            label: item.label,
            matchReason: codec.matchReason,
            summary: item.account,
          },
        ];
      });
    },

    async materializeClaims(scope, candidateId, target) {
      const item = await stores.readVaultItem(scope, candidateId);
      if (!item) throw new Error("The selected vault item was not found.");

      const codec = codecs.find(
        (candidate) =>
          candidate.vaultKind === item.kind &&
          candidate.surfaceKind === target.surface.kind
      );
      if (!codec) {
        throw new Error(
          "The selected vault item is not compatible with this form."
        );
      }

      const secret = await stores.readSecret({
        id: item.id,
        namespace: "vault",
        scope,
      });
      if (!secret) throw new Error("The selected vault item has no secret.");

      const values = codec.claims(item, secret);
      return [...target.availableTokens].flatMap((token) => {
        const value = values.get(token);
        return value ? [{ id: crypto.randomUUID(), token, value }] : [];
      });
    },
  };
}

export const vaultAutofillProvider = createVaultAutofillProvider();

function codecsForSurface(surface: DetectedAutofillSurface) {
  return codecs.filter((codec) => codec.surfaceKind === surface.kind);
}
