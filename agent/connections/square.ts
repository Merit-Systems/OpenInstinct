import { defineOpenAPIConnection } from "eve/connections";
import { squareAuth } from "@/agent/lib/square/auth";
import { squareReadOperations } from "@/agent/lib/square/operations";
import { env } from "@/env";
import { squareBaseUrl } from "@/lib/square";

export default defineOpenAPIConnection({
  spec: "https://raw.githubusercontent.com/square/connect-api-specification/551af55f16fce178780e6556570973aaf660e52a/api.json",
  baseUrl: squareBaseUrl(env.SQUARE_ENVIRONMENT),
  description:
    "The connected user's Square seller account: locations, catalog items, customers, orders, payments, invoices, inventory, and bookings. Read-only.",
  headers: { "Square-Version": "2025-04-16" },
  operations: { allow: squareReadOperations },
  auth: squareAuth,
});
