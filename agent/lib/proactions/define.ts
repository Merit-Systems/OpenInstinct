import { z } from "zod";
import { localTimeSchema, timezoneSchema } from "@/agent/lib/schedules/timing";

export const autonomyLevels = ["notify", "propose", "auto"] as const;
export const autonomySchema = z.enum(autonomyLevels);
export type Autonomy = z.infer<typeof autonomySchema>;

// User overrides and settings, shared by the chat tools, the web API, and the
// settings form.
export const proactionPolicyPatchSchema = z.strictObject({
  autonomy: autonomySchema.optional(),
  enabled: z.boolean().optional(),
});
export const proactionSettingsSchema = z.strictObject({
  briefLocalTime: localTimeSchema,
  timezone: timezoneSchema,
});
export const proactionSettingsPatchSchema = proactionSettingsSchema.partial();

const proactionCadenceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("brief") }),
  z.strictObject({
    kind: z.literal("weekly"),
    weekday: z.number().int().min(0).max(6),
  }),
  z.strictObject({
    everyMinutes: z.number().int().min(15).max(10_080),
    kind: z.literal("interval"),
  }),
]);
export type ProactionCadence = z.infer<typeof proactionCadenceSchema>;

const proactionRequirementKeys = ["google", "browser", "paymentCard"] as const;
export type ProactionRequirement = (typeof proactionRequirementKeys)[number];

const proactionIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,48}$/u, "Use a lower-case kebab-case id.");

// Metadata only, so the web app can read the catalog without bundling the
// markdown procedures that live beside each definition (see procedures.ts).
export const proactionDefinitionSchema = z.strictObject({
  act: z.boolean().default(false),
  cadence: proactionCadenceSchema,
  cooldownHours: z
    .number()
    .positive()
    .max(24 * 365),
  defaults: z.strictObject({
    autonomy: autonomySchema,
    enabled: z.boolean(),
  }),
  description: z.string().trim().min(1).max(300),
  id: proactionIdSchema,
  maxAutonomy: autonomySchema,
  requires: z.array(z.enum(proactionRequirementKeys)).default([]),
  title: z.string().trim().min(1).max(80),
});

export type ProactionDefinition = z.infer<typeof proactionDefinitionSchema>;

export function autonomyRank(level: Autonomy) {
  return autonomyLevels.indexOf(level);
}

export function minAutonomy(...levels: readonly Autonomy[]) {
  return levels.reduce((lowest, level) =>
    autonomyRank(level) < autonomyRank(lowest) ? level : lowest
  );
}

export function defineProaction(
  definition: z.input<typeof proactionDefinitionSchema>
): ProactionDefinition {
  const parsed = proactionDefinitionSchema.parse(definition);
  if (
    autonomyRank(parsed.defaults.autonomy) > autonomyRank(parsed.maxAutonomy)
  ) {
    throw new Error(
      `Proaction ${parsed.id} defaults to a higher autonomy than it allows.`
    );
  }
  if (parsed.maxAutonomy === "auto" && !parsed.act) {
    throw new Error(
      `Proaction ${parsed.id} allows auto autonomy but has no act procedure.`
    );
  }
  return parsed;
}
