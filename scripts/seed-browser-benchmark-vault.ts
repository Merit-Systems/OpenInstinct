import { randomUUID } from "node:crypto";
import { ensureScope } from "../db/services/scope";
import { createVaultItem } from "../db/services/vault";
import { accessScopeForUser } from "../lib/access-scope";
import { writeSecret } from "../lib/manager/server/secret-store";
import {
  serializeAddressVaultPayload,
  serializeContactVaultPayload,
} from "../lib/manager/vault-payload";

const scope = accessScopeForUser("better-auth:browser-benchmark");

await seedVaultItem(
  "contact",
  "Benchmark traveler",
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

async function seedVaultItem(
  kind: "address" | "contact",
  label: string,
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
    account: "",
    createdAt: now,
    id,
    kind,
    label,
    updatedAt: now,
  });
}
