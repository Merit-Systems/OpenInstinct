import type { ConnectTokenParams, ConnectTokenSubject } from "@vercel/connect";

export const squareScopes = [
  "MERCHANT_PROFILE_READ",
  "ITEMS_READ",
  "CUSTOMERS_READ",
  "ORDERS_READ",
  "PAYMENTS_READ",
  "INVOICES_READ",
  "INVENTORY_READ",
  "APPOINTMENTS_READ",
] as const;

export function squareSubject(userId: string): ConnectTokenSubject {
  return { id: userId, issuer: "openinstinct", type: "user" };
}

export function squareTokenParams(userId: string): ConnectTokenParams {
  return {
    scopes: [...squareScopes],
    subject: squareSubject(userId),
  };
}

export function squareBaseUrl(environment: "sandbox" | "production") {
  return environment === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}
