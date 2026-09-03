import { defineDynamic, defineTool, type ToolContext } from "eve/tools";
import { z } from "zod";
import { resolveModeValue } from "@/agent/lib/mode";
import { scopeFromPrincipal } from "@/agent/lib/principal-scope";
import { proactionById } from "@/agent/lib/proactions/catalog";
import { autonomySchema } from "@/agent/lib/proactions/define";
import { proactionIdentity } from "@/agent/lib/proactions/identity";
import { proactionOverview } from "@/agent/lib/proactions/overview";
import { reconcileProactions } from "@/agent/lib/proactions/reconcile";
import {
  recordFinding,
  recordFindingInputSchema,
  resolveFinding,
} from "@/db/services/proaction-findings";
import { saveProactionPolicy } from "@/db/services/proaction-policies";
import { saveProactionSettings } from "@/db/services/proaction-settings";

const timezoneSchema = z
  .string()
  .min(1)
  .refine((timezone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  }, "Use a valid IANA timezone.");

function userScope(context: ToolContext) {
  const auth = context.session.auth.current;
  if (auth?.principalType !== "user") {
    throw new Error("An authenticated user is required.");
  }
  return scopeFromPrincipal(auth);
}

export const recordProactionFinding = defineTool({
  description:
    "Record one distinct thing this proaction observed. fingerprint must be stable for the same situation so it is never surfaced twice; the tool returns duplicate when it was already recorded recently. Never message the user from a proaction run.",
  inputSchema: recordFindingInputSchema,
  async execute(input, context) {
    const identity = proactionIdentity(context.session.auth);
    if (identity?.role !== "worker") {
      throw new Error("Only a proaction run can record findings.");
    }
    const definition = proactionById(identity.proactionId);
    if (!definition) throw new Error("Unknown proaction.");
    const result = await recordFinding(
      userScope(context),
      identity.proactionId,
      identity.runId,
      input,
      definition.cooldownHours
    );
    return { findingId: result.finding.id, status: result.status };
  },
});

export const listProactions = defineTool({
  description:
    "List the proactive behaviors (proactions) available to the user with their effective settings, readiness, and recent findings. Use before changing one.",
  inputSchema: z.object({}),
  execute: (_input, context) => proactionOverview(userScope(context)),
});

export const configureProaction = defineTool({
  description:
    "Turn a proaction on or off, or change how autonomously it acts: notify (just tell me), propose (ask before acting), auto (act, then tell me). Autonomy is capped by the deployment; the result reports the effective values.",
  inputSchema: z
    .strictObject({
      autonomy: autonomySchema.optional(),
      enabled: z.boolean().optional(),
      proactionId: z.string().min(1),
    })
    .refine(
      ({ autonomy, enabled }) =>
        autonomy !== undefined || enabled !== undefined,
      { message: "Provide enabled or autonomy." }
    ),
  async execute({ proactionId, ...patch }, context) {
    if (!proactionById(proactionId)) throw new Error("Unknown proaction.");
    const scope = userScope(context);
    await saveProactionPolicy(scope, proactionId, patch);
    const entry = (await reconcileProactions(scope)).find(
      (candidate) => candidate.definition.id === proactionId
    );
    if (!entry) throw new Error("Unknown proaction.");
    return {
      autonomy: entry.policy.autonomy,
      autonomyCeiling: entry.policy.autonomyCeiling,
      clamped:
        patch.autonomy !== undefined &&
        patch.autonomy !== entry.policy.autonomy,
      enabled: entry.policy.enabled,
      proactionId,
      status: entry.job.status,
    };
  },
});

export const updateProactionSettings = defineTool({
  description:
    "Set the user's timezone and the local time of day (24-hour HH:MM) when daily and weekly proactions run and deliver.",
  inputSchema: z
    .strictObject({
      briefLocalTime: z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "Use a 24-hour HH:MM time.")
        .optional(),
      timezone: timezoneSchema.optional(),
    })
    .refine(
      ({ briefLocalTime, timezone }) =>
        briefLocalTime !== undefined || timezone !== undefined,
      { message: "Provide a timezone or a brief time." }
    ),
  async execute(input, context) {
    const scope = userScope(context);
    const settings = await saveProactionSettings(scope, input);
    await reconcileProactions(scope);
    return {
      briefLocalTime: settings.briefLocalTime,
      timezone: settings.timezone,
    };
  },
});

export const resolveProactionFinding = defineTool({
  description:
    "Mark a proaction finding as acted on (the proposed action was completed) or dismissed (the user does not want it).",
  inputSchema: z.strictObject({
    findingId: z.uuid(),
    status: z.enum(["acted", "dismissed"]),
  }),
  async execute({ findingId, status }, context) {
    const finding = await resolveFinding(userScope(context), findingId, status);
    if (!finding) throw new Error("Finding not found.");
    return { findingId, status: finding.status };
  },
});

const interactiveTools = {
  "proactions-configure": configureProaction,
  "proactions-list": listProactions,
  "proactions-resolve": resolveProactionFinding,
  "proactions-settings": updateProactionSettings,
};
const reportTools = { "proactions-resolve": resolveProactionFinding };
const workerTools = { "proactions-record-finding": recordProactionFinding };

export default defineDynamic({
  events: {
    "turn.started": (_event, context) => {
      // Background tools exist only inside a proaction run or its report.
      if (!proactionIdentity(context.session.auth)) {
        return resolveModeValue(context, { interactive: interactiveTools });
      }
      return (
        resolveModeValue(context, { "scheduled-worker": workerTools }) ??
        resolveModeValue(context, { "scheduled-report": reportTools })
      );
    },
  },
});
