import { randomUUID } from "node:crypto";
import { ensureScope } from "../db/services/scope";
import { createVaultItem } from "../db/services/vault";
import { accessScopeForUser } from "../lib/access-scope";
import { serializePaymentCard } from "../lib/manager/payment-card";
import { writeSecret } from "../lib/manager/server/secret-store";
import {
  serializeAddressVaultPayload,
  serializeContactVaultPayload,
} from "../lib/manager/vault-payload";

const scope = accessScopeForUser("better-auth:browser-benchmark");

await seedVaultItem(
  "contact",
  "Benchmark traveler",
  "",
  serializeContactVaultPayload({
    dateOfBirth: "1990-01-01",
    email: "browser-benchmark@example.com",
    fullName: "Alex Morgan",
    kind: "contact",
    phone: "+15555550100",
    version: 1,
  })
);
await seedVaultItem(
  "address",
  "Benchmark address",
  "",
  serializeAddressVaultPayload({
    city: "Brooklyn",
    countryCode: "US",
    kind: "address",
    line1: "300 Kent Ave",
    postalCode: "11249",
    recipientName: "Alex Morgan",
    region: "NY",
    version: 1,
  })
);
await seedVaultItem(
  "payment",
  "Benchmark test card",
  "Visa · •••• 4242",
  serializePaymentCard({
    billingPostalCode: "11249",
    cardholderName: "Alex Morgan",
    expirationMonth: 12,
    expirationYear: 2034,
    kind: "payment-card",
    number: "4242424242424242",
    securityCode: "123",
    version: 1,
  })
);

async function seedVaultItem(
  kind: Parameters<typeof createVaultItem>[1]["kind"],
  label: string,
  account: string,
  secret: string
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  await ensureScope(scope);
  await writeSecret({
    id,
    namespace: "vault",
    scope,
    value: secret,
  });
  await createVaultItem(scope, {
    account,
    createdAt: now,
    id,
    kind,
    label,
    updatedAt: now,
  });
}
