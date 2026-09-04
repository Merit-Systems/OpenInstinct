import { readProactionPolicies } from "@/db/services/proaction-policies";
import { readProactionSettings } from "@/db/services/proaction-settings";
import {
  listRunFindings,
  recentFingerprints,
} from "@/db/services/proaction-findings";
import type {
  claimReadyScheduledAgentRuns,
  claimScheduledReport,
} from "@/db/services/scheduled-agent-jobs";
import type { AccessScope } from "@/lib/access-scope";
import { adminPolicy } from "./admin";
import { proactionById } from "./catalog";
import { effectiveProactionPolicy } from "./policy";
import { proactionProcedure } from "./procedures";
import { proactionReportPrompt, proactionWorkerPrompt } from "./prompt";

type ClaimedRun = Awaited<
  ReturnType<typeof claimReadyScheduledAgentRuns>
>[number];
type ClaimedReport = NonNullable<
  Awaited<ReturnType<typeof claimScheduledReport>>
>;

function jobScope(job: ClaimedRun["job"]): AccessScope {
  return { userId: job.createdByUserId, workspaceId: job.workspaceId };
}

async function loadPolicy(scope: AccessScope, proactionId: string) {
  const definition = proactionById(proactionId);
  if (!definition) return undefined;
  const policies = await readProactionPolicies(scope);
  return {
    definition,
    policy: effectiveProactionPolicy(
      definition,
      adminPolicy,
      policies.get(proactionId)
    ),
  };
}

// The worker prompt for a claimed proaction run, or undefined when the job's
// proaction no longer exists in the catalog.
export async function proactionRunPrompt(claim: ClaimedRun) {
  const { proactionId } = claim.job;
  if (!proactionId) return undefined;
  const scope = jobScope(claim.job);
  const loaded = await loadPolicy(scope, proactionId);
  if (!loaded) return undefined;
  const [settings, known] = await Promise.all([
    readProactionSettings(scope),
    recentFingerprints(scope, proactionId),
  ]);
  return proactionWorkerPrompt(
    loaded.definition,
    proactionProcedure(proactionId),
    loaded.policy,
    known,
    settings,
    claim.run.scheduledFor
  );
}

export async function proactionReportTurnPrompt(claimed: ClaimedReport) {
  const { proactionId } = claimed.job;
  if (!proactionId) return undefined;
  const loaded = await loadPolicy(jobScope(claimed.job), proactionId);
  if (!loaded) return undefined;
  const findings = await listRunFindings(claimed.run.id);
  const handoff =
    claimed.run.outcome?.kind === "result"
      ? claimed.run.outcome.summary
      : claimed.run.outcome?.kind === "blocked"
        ? `${claimed.run.outcome.summary} ${claimed.run.outcome.userActionNeeded}`
        : undefined;
  return proactionReportPrompt(
    loaded.definition,
    loaded.policy,
    findings,
    handoff
  );
}
