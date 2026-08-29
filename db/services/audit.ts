import { randomUUID } from "node:crypto";
import type { AccessScope } from "@/lib/access-scope";
import { auditEvents, db, type AuditEventOutcome } from "@/db";

export async function recordAuditEvent(
  scope: AccessScope,
  event: {
    readonly action: string;
    readonly actorUserId?: string | null;
    readonly correlationId?: string;
    readonly createdAt?: string;
    readonly metadata?: unknown;
    readonly outcome?: AuditEventOutcome;
    readonly target?: string;
  }
) {
  await db.insert(auditEvents).values({
    action: event.action,
    actorUserId: event.actorUserId ?? scope.userId,
    correlationId: event.correlationId,
    createdAt: event.createdAt,
    id: randomUUID(),
    metadata: event.metadata,
    outcome: event.outcome,
    target: event.target,
    workspaceId: scope.workspaceId,
  });
}
