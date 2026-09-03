import { z } from "zod";
import { env } from "@/env";
import { autonomySchema } from "./define";

// Deployment-level ceiling for every workspace. The deployer edits the checked
// in defaults or supplies PROACTIONS_ADMIN_POLICY as JSON with the same shape.
const adminPolicySchema = z.strictObject({
  disabled: z.array(z.string()).default([]),
  maxAutonomy: autonomySchema.default("auto"),
  overrides: z
    .record(
      z.string(),
      z.strictObject({
        enabled: z.boolean().optional(),
        maxAutonomy: autonomySchema.optional(),
      })
    )
    .default({}),
});

export type AdminPolicy = z.infer<typeof adminPolicySchema>;

const checkedInDefaults = adminPolicySchema.parse({
  disabled: [],
  maxAutonomy: "auto",
  overrides: {},
});

export function parseAdminPolicy(json: string | undefined) {
  if (!json) return checkedInDefaults;
  return adminPolicySchema.parse(JSON.parse(json));
}

export const adminPolicy = parseAdminPolicy(env.PROACTIONS_ADMIN_POLICY);
