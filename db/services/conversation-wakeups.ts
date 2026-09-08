import { and, eq, inArray, lte } from "drizzle-orm";
import { db, scheduledAgentJobs, scheduledAgentRuns } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import type { claimReadyScheduledAgentRuns } from "./scheduled-agent-jobs";
import { ensureScope } from "./scope";

export async function ensureDailyCheckIn(
  scope: AccessScope,
  conversationId: string,
  prompt: string,
  now = new Date()
) {
  await ensureScope(scope);
  const firstRun = new Date(now.getTime() + 24 * 60 * 60_000);
  await db
    .insert(scheduledAgentJobs)
    .values({
      workspaceId: scope.workspaceId,
      createdByUserId: scope.userId,
      conversationChannel: "linq",
      conversationId,
      defaultKey: "daily-check-in",
      execution: "conversation",
      prompt,
      timing: {
        kind: "interval",
        everyMinutes: 1440,
        anchoredAt: firstRun.toISOString(),
      },
      nextRunAt: firstRun,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [
        scheduledAgentJobs.workspaceId,
        scheduledAgentJobs.createdByUserId,
        scheduledAgentJobs.defaultKey,
      ],
    });
}

// A wake-up is a best-effort nudge: never replay an uncertain handoff into the
// main conversation. The next occurrence gets another opportunity to check in.
export async function expireConversationWakeups(now: Date) {
  await db
    .update(scheduledAgentRuns)
    .set({
      status: "dead_letter",
      reportStatus: "not_needed",
      completedAt: now,
      lastError: "Wake-up delivery was not confirmed; it will not be retried.",
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(scheduledAgentRuns.status, "running"),
        lte(scheduledAgentRuns.leaseExpiresAt, now),
        eq(
          scheduledAgentRuns.jobId,
          db
            .select({ id: scheduledAgentJobs.id })
            .from(scheduledAgentJobs)
            .where(
              and(
                eq(scheduledAgentJobs.id, scheduledAgentRuns.jobId),
                eq(scheduledAgentJobs.execution, "conversation")
              )
            )
        )
      )
    );
}

export async function isConversationWakeupCurrent(
  scope: AccessScope,
  id: string,
  revision: number,
  conversationId: string
) {
  const job = await db.query.scheduledAgentJobs.findFirst({
    columns: { id: true },
    where: and(
      eq(scheduledAgentJobs.id, id),
      eq(scheduledAgentJobs.workspaceId, scope.workspaceId),
      eq(scheduledAgentJobs.createdByUserId, scope.userId),
      eq(scheduledAgentJobs.conversationId, conversationId),
      eq(scheduledAgentJobs.execution, "conversation"),
      inArray(scheduledAgentJobs.status, ["active", "completed"]),
      eq(scheduledAgentJobs.revision, revision)
    ),
  });
  return job !== undefined;
}

export async function finishConversationWakeup(
  claim: Awaited<ReturnType<typeof claimReadyScheduledAgentRuns>>[number],
  error?: string
) {
  if (!claim.run.leaseToken) return;
  const now = new Date();
  await db
    .update(scheduledAgentRuns)
    .set({
      status: error ? "dead_letter" : "completed",
      reportStatus: "not_needed",
      completedAt: now,
      updatedAt: now,
      lastError: error ?? null,
      leaseToken: null,
      leaseExpiresAt: null,
      outcome: {
        kind: "nothing_to_report",
        reason:
          error ??
          "Wake-up handed to the main conversation; this records delivery, not completion of its work.",
      },
    })
    .where(
      and(
        eq(scheduledAgentRuns.id, claim.run.id),
        eq(scheduledAgentRuns.leaseToken, claim.run.leaseToken)
      )
    );
}
