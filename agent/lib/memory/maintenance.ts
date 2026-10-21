import { del } from "@vercel/blob";
import {
  claimMemoryBlobPurge,
  completeMemoryBlobPurge,
  listPendingMemoryBlobPurges,
} from "@db/services/memory/artifacts";
import {
  claimMemoryJob,
  checkpointMemoryJob,
  deferMemoryJob,
  listReadyMemoryJobs,
  publishMemoryJob,
  rejectMemoryJob,
  releaseMemoryJob,
} from "@db/services/memory/jobs";
import {
  MemoryBudgetExceededError,
  MemoryRequestTooLargeError,
} from "@db/services/memory/usage";
import { readMemoryState } from "@db/services/memory/scope";
import { postMemoryRecovery } from "@agent/lib/schedules/request";
import { env } from "@shared/environment";
import { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";
import { memoryProposalSchema } from "@shared/memory/schema";
import { reconcileKnowledge } from "./reconcile";
import { uploadKnowledgeArtifacts } from "./publish";

export async function maintainKnowledge() {
  await purgeKnowledgeArtifacts();
  if (env.KNOWLEDGE_MEMORY_MODE === "off") return;
  try {
    await postMemoryRecovery();
  } catch {
    console.warn("[memory] source recovery will retry on the next tick");
  }
  const workspaceIds = env.KNOWLEDGE_MEMORY_WORKSPACES?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const ready = await listReadyMemoryJobs(4, workspaceIds);
  await Promise.all(ready.map(processKnowledgeJob));
}

async function processKnowledgeJob(
  ready: Awaited<ReturnType<typeof listReadyMemoryJobs>>[number]
) {
  const { scope, scopeKey } = ready;
  if (knowledgeMemoryModeForWorkspace(scope.workspaceId) === "off") return;
  const job = await claimMemoryJob(scope, scopeKey, ready.id);
  if (!job) return;
  let publishing = false;
  try {
    const signal = AbortSignal.timeout(45_000);
    const proposal = job.checkpoint
      ? memoryProposalSchema.parse(job.checkpoint)
      : job.sources.length
        ? await reconcileKnowledge(scope, scopeKey, job.sources, signal, job)
        : { records: [], links: [] };
    if (!job.checkpoint)
      await checkpointMemoryJob(
        scope,
        scopeKey,
        job.id,
        job.leaseToken,
        proposal
      );
    const snapshots = new Map(
      job.exportRecords.map((record) => [record.id, record])
    );
    for (const record of proposal.records)
      snapshots.set(record.id, {
        id: record.id,
        revision: record.expectedRevision + 1,
        content: record.content,
      });
    const state = await readMemoryState(scope, scopeKey);
    const artifacts = await uploadKnowledgeArtifacts(
      scope,
      scopeKey,
      job,
      [...snapshots.values()],
      signal,
      proposal
    );
    publishing = true;
    await publishMemoryJob(scope, scopeKey, {
      ...proposal,
      jobId: job.id,
      leaseToken: job.leaseToken,
      expectedEpoch: job.epoch,
      expectedGeneration: state.generation,
      artifacts,
    });
  } catch (error) {
    if (error instanceof MemoryRequestTooLargeError) {
      await rejectMemoryJob(scope, scopeKey, job.id, job.leaseToken);
      return;
    }
    if (error instanceof MemoryBudgetExceededError) {
      await deferMemoryJob(
        scope,
        scopeKey,
        job.id,
        job.leaseToken,
        error.retryAt
      );
      return;
    }
    await releaseMemoryJob(scope, scopeKey, job.id, job.leaseToken, {
      discardCheckpoint: publishing,
    });
    console.warn("[memory] maintenance attempt failed", {
      jobId: job.id,
      attempt: job.attempts,
    });
  }
}

async function purgeKnowledgeArtifacts() {
  const artifacts = await listPendingMemoryBlobPurges(25);
  await Promise.all(
    artifacts.map(async (artifact) => {
      try {
        if (
          !(await claimMemoryBlobPurge(
            artifact.scope,
            artifact.scopeKey,
            artifact.pathname
          ))
        )
          return;
        await del(artifact.pathname, {
          storeId: env.BLOB_STORE_ID,
          token: env.BLOB_READ_WRITE_TOKEN,
          abortSignal: AbortSignal.timeout(10_000),
        });
        await completeMemoryBlobPurge(
          artifact.scope,
          artifact.scopeKey,
          artifact.pathname
        );
      } catch {
        console.warn("[memory] artifact deletion will retry", {
          jobId: artifact.jobId,
        });
      }
    })
  );
}
