import type { replaceUserProfile as replaceUserProfileType } from "../db/services/user-profile";
import { saveVaultItem } from "../db/services/vault";
import { nodeErrorCode } from "../evals/browser/node-error";
import { accessScopeForUser } from "../src/lib/access-scope";
import { serializePaymentCard } from "../src/lib/vault";

const scope = accessScopeForUser("better-auth:browser-benchmark");

await seedStructuredProfileWhenSupported();

await seedVaultItem(
  "payment",
  "Benchmark test card",
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
  kind: Parameters<typeof saveVaultItem>[1]["kind"],
  label: string,
  secret: string
) {
  await saveVaultItem(scope, {
    account: "",
    kind,
    label,
    secret,
  });
}

async function seedStructuredProfileWhenSupported() {
  let replaceUserProfile: typeof replaceUserProfileType;
  try {
    ({ replaceUserProfile } = await import("../db/services/user-profile"));
  } catch (error) {
    if (nodeErrorCode(error) === "ERR_MODULE_NOT_FOUND") {
      console.warn(
        "Skipping structured benchmark profile for a revision that predates profile storage."
      );
      return;
    }
    throw error;
  }

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
}
