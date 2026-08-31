import { randomUUID } from "node:crypto";
import { ensureScope } from "../db/services/scope";
import { replaceUserProfile } from "../db/services/user-profile";
import { createVaultItem } from "../db/services/vault";
import { accessScopeForUser } from "../src/lib/access-scope";
import { serializePaymentCard } from "../src/lib/manager/payment-card";
import { writeSecret } from "../src/lib/manager/server/secret-store";

const scope = accessScopeForUser("better-auth:browser-benchmark");

await replaceUserProfile(scope, {
  addressLine1: "123 Test Street",
  addressLine2: "Apartment 4B",
  city: "Brooklyn",
  countryCode: "US",
  dateOfBirth: "1990-01-01",
  email: "browser-benchmark@example.com",
  firstName: "John",
  lastName: "Smith",
  phone: "+12025550100",
  postalCode: "11201",
  region: "NY",
});

await seedVaultItem(
  "payment",
  "Benchmark test card",
  "Visa · •••• 4242",
  serializePaymentCard({
    billingPostalCode: "11201",
    cardholderName: "John Smith",
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
