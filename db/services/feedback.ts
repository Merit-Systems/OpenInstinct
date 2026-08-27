import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import { feedbackRecordSchema, type FeedbackSubmission } from "@/lib/feedback";
import { agentSessions, db, feedbackEntries } from "@/db";

export async function saveFeedback(
  scope: AccessScope,
  submission: FeedbackSubmission
) {
  const claimedSessions = await db
    .select({ sessionId: agentSessions.sessionId })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.sessionId, submission.sessionId),
        eq(agentSessions.workspaceId, scope.workspaceId),
        eq(agentSessions.createdByUserId, scope.userId)
      )
    )
    .limit(1);
  if (!claimedSessions[0]) {
    throw new Error(
      "The authenticated feedback scope does not match this conversation."
    );
  }

  const now = new Date().toISOString();
  const rows = await db
    .insert(feedbackEntries)
    .values({
      category: submission.category,
      createdAt: now,
      createdByUserId: scope.userId,
      eveSessionId: submission.sessionId,
      eveTurnId: submission.turnId,
      feedback: submission.feedback,
      id: randomUUID(),
      idempotencyKey: submission.idempotencyKey,
      toolCallId: submission.toolCallId,
      updatedAt: now,
      workspaceId: scope.workspaceId,
    })
    .onConflictDoUpdate({
      target: [feedbackEntries.workspaceId, feedbackEntries.idempotencyKey],
      set: { idempotencyKey: submission.idempotencyKey },
    })
    .returning({
      category: feedbackEntries.category,
      createdAt: feedbackEntries.createdAt,
      feedback: feedbackEntries.feedback,
      id: feedbackEntries.id,
      status: feedbackEntries.status,
    });
  return feedbackRecordSchema.parse(rows[0]);
}
