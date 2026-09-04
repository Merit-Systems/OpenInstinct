import type { proactionFindings } from "@/db/schema";
import type { recentFingerprints } from "@/db/services/proaction-findings";
import type { ProactionSettings } from "@/db/services/proaction-settings";
import type { ProactionDefinition } from "./define";
import type { EffectiveProactionPolicy } from "./policy";
import type { ProactionProcedure } from "./procedures";

export function proactionWorkerPrompt(
  definition: ProactionDefinition,
  procedure: ProactionProcedure,
  policy: EffectiveProactionPolicy,
  known: Awaited<ReturnType<typeof recentFingerprints>>,
  settings: Pick<ProactionSettings, "briefLocalTime" | "timezone">,
  scheduledFor: Date
) {
  const knownList =
    known.length === 0
      ? "None yet."
      : known
          .map(
            (finding) =>
              `- ${finding.fingerprint} (${finding.status}, ${finding.createdAt.toISOString()}): ${finding.summary}`
          )
          .join("\n");
  const autonomy = {
    auto: procedure.act
      ? `auto: when a finding qualifies under the act procedure below, complete the action yourself in this run, then record the finding with actionStatus "completed" (or "failed" with the reason). Record any other finding with actionStatus "none".\n\n## Act procedure\n\n${procedure.act}`
      : 'auto is allowed but this proaction has no act procedure, so behave as "propose".',
    notify:
      'notify: never act. Record each finding with actionStatus "none" and no proposedAction.',
    propose:
      'propose: never act. For a finding with a clear next step, put the exact action in proposedAction and set actionStatus "proposed".',
  }[policy.autonomy];
  return [
    `Run the proaction "${definition.title}" (${definition.id}) as a background observation.`,
    `Scheduled for: ${scheduledFor.toISOString()}. User timezone: ${settings.timezone}. Brief time: ${settings.briefLocalTime}.`,
    `Effective autonomy is ${autonomy}`,
    `## Observe procedure\n\n${procedure.observe}`,
    `## Already known fingerprints\n\nDo not record these again unless the situation materially changed; recording an unchanged one returns duplicate.\n\n${knownList}`,
    "Record every distinct finding with proactions-record-finding. When nothing qualifies, record nothing and finish with a one-line handoff saying so.",
  ].join("\n\n");
}

export function proactionReportPrompt(
  definition: ProactionDefinition,
  policy: EffectiveProactionPolicy,
  findings: readonly (typeof proactionFindings.$inferSelect)[],
  workerHandoff: string | undefined
) {
  const list = findings
    .map((finding) =>
      [
        `- id ${finding.id} [${finding.urgency}] ${finding.summary}`,
        finding.details ? `  details: ${finding.details}` : undefined,
        finding.proposedAction
          ? `  proposed action: ${finding.proposedAction}`
          : undefined,
        `  action status: ${finding.actionStatus}`,
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");
  return [
    `The proaction "${definition.title}" finished a background observation with new findings. Effective autonomy: ${policy.autonomy}.`,
    `## Findings\n\n${list}`,
    workerHandoff ? `## Worker handoff\n\n${workerHandoff}` : undefined,
    "Decide whether the user should hear about this now, following the proaction reporting rules.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
