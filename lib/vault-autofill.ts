import { z } from "zod";
import type { VaultItemKind } from "./manager";
import { parsePaymentCardSecret } from "./payment-card.ts";

export const vaultAutofillFieldSchema = z.enum([
  "username",
  "password",
  "cardholder_name",
  "card_number",
  "expiration",
  "expiration_month",
  "expiration_year",
  "cvc",
  "billing_postal_code",
  "address",
  "phone",
  "identity",
  "token",
]);

const exactOriginSchema = z.url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && url.origin === value;
}, "Use the exact HTTP(S) origin without a path, query, or trailing slash.");

const vaultAutofillTargetSchema = z.object({
  field: vaultAutofillFieldSchema,
  frameSelector: z.string().trim().min(1).max(1_000).optional(),
  selector: z.string().trim().min(1).max(1_000),
});

export const vaultAutofillRequestSchema = z.object({
  browserSessionId: z.string().trim().min(1).max(500).optional(),
  expectedOrigin: exactOriginSchema,
  fields: z.array(vaultAutofillTargetSchema).min(1).max(20),
  vaultItemId: z.uuid(),
});

export function resolveVaultAutofillValues(
  item: {
    readonly account: string;
    readonly kind: VaultItemKind;
  },
  secret: string,
  fields: readonly z.infer<typeof vaultAutofillFieldSchema>[]
) {
  const values = vaultValues(item, secret);

  return fields.map((field) => {
    const value = values.get(field);
    if (value === undefined || value.length === 0) {
      throw new Error(
        `The selected ${item.kind} vault item does not provide ${field}.`
      );
    }
    return { field, value };
  });
}

function vaultValues(
  item: {
    readonly account: string;
    readonly kind: VaultItemKind;
  },
  secret: string
) {
  const values = new Map<z.infer<typeof vaultAutofillFieldSchema>, string>();

  switch (item.kind) {
    case "login":
      values.set("username", item.account);
      values.set("password", secret);
      break;
    case "payment": {
      const card = parsePaymentCardSecret(secret);
      const month = card.expirationMonth.toString().padStart(2, "0");
      const year = card.expirationYear.toString();
      values.set("cardholder_name", card.cardholderName);
      values.set("card_number", card.number);
      values.set("expiration", `${month}/${year.slice(-2)}`);
      values.set("expiration_month", month);
      values.set("expiration_year", year);
      values.set("cvc", card.securityCode);
      values.set("billing_postal_code", card.billingPostalCode);
      break;
    }
    case "address":
      values.set("address", secret);
      break;
    case "phone":
      values.set("phone", secret);
      break;
    case "identity":
      values.set("identity", secret);
      break;
    case "token":
      values.set("token", secret);
      break;
  }

  return values;
}
