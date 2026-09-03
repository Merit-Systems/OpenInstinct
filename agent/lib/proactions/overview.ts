import type { AccessScope } from "@/lib/access-scope";
import { listFindings } from "@/db/services/proaction-findings";
import { readProactionSettings } from "@/db/services/proaction-settings";
import { autonomyLevels, autonomyRank } from "./define";
import { describeMissingRequirement } from "./prerequisites";
import { reconcileProactions } from "./reconcile";
import { describeCadence } from "./timing";

// One reconcile doubles as the read model: it returns the catalog joined with
// the effective policy, readiness, and the system job, exactly as persisted.
export async function proactionOverview(scope: AccessScope) {
  const [entries, settings, findings] = await Promise.all([
    reconcileProactions(scope),
    readProactionSettings(scope),
    listFindings(scope),
  ]);
  return {
    findings: findings.map((finding) => ({
      actionStatus: finding.actionStatus,
      createdAt: finding.createdAt.toISOString(),
      details: finding.details,
      id: finding.id,
      proactionId: finding.proactionId,
      proposedAction: finding.proposedAction,
      status: finding.status,
      summary: finding.summary,
      urgency: finding.urgency,
    })),
    proactions: entries.map(({ definition, job, policy, readiness }) => ({
      allowedAutonomy: autonomyLevels.filter(
        (level) => autonomyRank(level) <= autonomyRank(policy.autonomyCeiling)
      ),
      autonomy: policy.autonomy,
      autonomyCeiling: policy.autonomyCeiling,
      cadence: describeCadence(definition.cadence),
      description: definition.description,
      enabled: policy.enabled,
      id: definition.id,
      lastError: job.lastError,
      lastRunAt: job.lastRunAt?.toISOString() ?? null,
      nextRunAt: job.nextRunAt?.toISOString() ?? null,
      state: policy.adminDisabled
        ? ("admin_disabled" as const)
        : !policy.enabled
          ? ("off" as const)
          : readiness.ready
            ? ("active" as const)
            : ("waiting" as const),
      title: definition.title,
      waitingOn: readiness.missing.map(describeMissingRequirement),
    })),
    settings: {
      briefLocalTime: settings.briefLocalTime,
      deliveryChannel: settings.linqThreadId
        ? ("imessage" as const)
        : ("inbox" as const),
      timezone: settings.timezone,
    },
  };
}

export type ProactionOverview = Awaited<ReturnType<typeof proactionOverview>>;
