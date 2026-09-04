import { readProactionPolicies } from "@/db/services/proaction-policies";
import { readProactionSettings } from "@/db/services/proaction-settings";
import { upsertProactionJob } from "@/db/services/scheduled-agent-jobs";
import type { AccessScope } from "@/lib/access-scope";
import { adminPolicy } from "./admin";
import { proactions } from "./catalog";
import { effectiveProactionPolicy } from "./policy";
import { proactionPrerequisiteChecker } from "./prerequisites";
import { proactionTiming } from "./timing";

function inboxOnlyConversationId(scope: AccessScope) {
  return `proactions:${scope.workspaceId}`;
}

export function isInboxOnlyConversation(conversationId: string) {
  return conversationId.startsWith("proactions:");
}

// Brings the workspace's system-owned jobs in line with the catalog, the
// three policy layers, and the current prerequisites. Idempotent and cheap
// enough to run on every session start.
export async function reconcileProactions(
  scope: AccessScope,
  now = new Date()
) {
  const [settings, userPolicies, isReady] = await Promise.all([
    readProactionSettings(scope),
    readProactionPolicies(scope),
    proactionPrerequisiteChecker(scope),
  ]);
  const conversation = settings.linqThreadId
    ? {
        conversationChannel: "linq" as const,
        conversationId: settings.linqThreadId,
      }
    : {
        conversationChannel: "eve" as const,
        conversationId: inboxOnlyConversationId(scope),
      };
  const entries = await Promise.all(
    proactions.map(async (definition) => {
      const policy = effectiveProactionPolicy(
        definition,
        adminPolicy,
        userPolicies.get(definition.id)
      );
      const readiness = isReady(definition);
      const job = await upsertProactionJob(
        scope,
        definition.id,
        {
          ...conversation,
          status: policy.enabled && readiness.ready ? "active" : "paused",
          timing: proactionTiming(definition.cadence, settings, now),
        },
        now
      );
      return { definition, job, policy, readiness };
    })
  );
  return { entries, settings };
}
