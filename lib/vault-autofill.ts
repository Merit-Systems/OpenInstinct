import { z } from "zod";
import type { VaultItemKind } from "@/lib/manager";
import { parsePaymentCardSecret } from "@/lib/payment-card";
import {
  parseAddressVaultPayload,
  parseContactVaultPayload,
  parseLoginVaultPayload,
} from "@/lib/vault-payload";

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
  "address_line1",
  "address_line2",
  "address_city",
  "address_region",
  "address_postal_code",
  "address_country",
  "full_name",
  "email",
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
    case "login": {
      const payload = parseLoginVaultPayload(secret);
      if (!payload) {
        values.set("username", item.account);
        values.set("password", secret);
        break;
      }
      values.set("username", payload.identifier.value);
      if (payload.identifier.type === "email") {
        values.set("email", payload.identifier.value);
      }
      if (payload.identifier.type === "phone") {
        values.set("phone", payload.identifier.value);
      }
      if (payload.authentication.type === "password") {
        values.set("password", payload.authentication.password);
      }
      break;
    }
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
    case "address": {
      const payload = parseAddressVaultPayload(secret);
      if (!payload) {
        values.set("address", secret);
        break;
      }
      values.set("full_name", payload.recipientName);
      values.set("address_line1", payload.line1);
      if (payload.line2) values.set("address_line2", payload.line2);
      values.set("address_city", payload.city);
      values.set("address_region", payload.region);
      values.set("address_postal_code", payload.postalCode);
      values.set("address_country", payload.countryCode);
      values.set(
        "address",
        [
          payload.recipientName,
          payload.line1,
          payload.line2,
          `${payload.city}, ${payload.region} ${payload.postalCode}`,
          payload.countryCode,
        ]
          .filter(Boolean)
          .join("\n")
      );
      break;
    }
    case "contact": {
      const payload = parseContactVaultPayload(secret);
      if (!payload)
        throw new Error("The saved contact is incomplete or invalid.");
      if (payload.fullName) values.set("full_name", payload.fullName);
      if (payload.email) values.set("email", payload.email);
      if (payload.phone) values.set("phone", payload.phone);
      break;
    }
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
