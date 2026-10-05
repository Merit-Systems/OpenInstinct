import { getVercelOidcToken } from "@vercel/oidc";
import { scheduledResponseSchema } from "../shared/schedules/wakeups.ts";
import { z } from "zod";

const origin = new URL(z.url().parse(process.argv[2]));
if (origin.protocol !== "https:" || origin.username || origin.password) {
  throw new Error("Provide the deployment's HTTPS URL without credentials.");
}
const token = await getVercelOidcToken();
const response = await fetch(
  new URL("/api/scheduled-wakeups/migrate", origin),
  {
    body: JSON.stringify({ kind: "backfill" }),
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      "x-vercel-trusted-oidc-idp-token": token,
    },
    method: "POST",
    redirect: "error",
  }
);
if (!response.ok)
  throw new Error("Wakeup migration failed (" + String(response.status) + ").");
scheduledResponseSchema.parse(await response.json());
console.info("Existing schedules and pending deliveries have been armed.");
