import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AccessScope } from "@/lib/access-scope";
import { db, proactionFindings } from "@/db";

const findingUrgencySchema = z.enum(["normal", "time_sensitive"]);
const findingActionStatusSchema = z.enum([
  "none",
  "proposed",
  "completed",
  "failed",
]);

export const recordFindingInputSchema = z.strictObject({
  actionStatus: findingActionStatusSchema.default("none"),
  details: z.string().trim().min(1).max(8_000).optional(),
  fingerprint: z.string().trim().min(1).max(200),
  proposedAction: z.string().trim().min(1).max(2_000).optional(),
  summary: z.string().trim().min(1).max(2_000),
  urgency: findingUrgencySchema.default("normal"),
});

export type RecordFindingInput = z.infer<typeof recordFindingInputSchema>;

export async function recordFinding(
  scope: AccessScope,
  proactionId: string,
  runId: string | null,
  input: RecordFindingInput,
  cooldownHours: number,
  now = new Date()
) {
  const cooldownStart = new Date(now.getTime() - cooldownHours * 3_600_000);
  return db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(proactionFindings)
      .where(
        and(
          eq(proactionFindings.workspaceId, scope.workspaceId),
          eq(proactionFindings.proactionId, proactionId),
          eq(proactionFindings.fingerprint, input.fingerprint)
        )
      )
      .limit(1)
      .for("update");
    if (existing && existing.createdAt.getTime() >= cooldownStart.getTime()) {
      return { finding: existing, status: "duplicate" as const };
    }
    const values = {
      actionStatus: input.actionStatus,
      createdAt: now,
      deliveredAt: null,
      details: input.details ?? null,
      fingerprint: input.fingerprint,
      proactionId,
      proposedAction: input.proposedAction ?? null,
      runId,
      status: "new" as const,
      summary: input.summary,
      updatedAt: now,
      urgency: input.urgency,
      workspaceId: scope.workspaceId,
    };
    const [finding] = existing
      ? await transaction
          .update(proactionFindings)
          .set(values)
          .where(eq(proactionFindings.id, existing.id))
          .returning()
      : await transaction.insert(proactionFindings).values(values).returning();
    if (!finding) throw new Error("The finding could not be recorded.");
    return { finding, status: "recorded" as const };
  });
}

export async function listRunFindings(runId: string) {
  return db
    .select()
    .from(proactionFindings)
    .where(eq(proactionFindings.runId, runId))
    .orderBy(
      desc(proactionFindings.urgency),
      desc(proactionFindings.createdAt)
    );
}

export async function markRunFindingsDelivered(
  runId: string,
  now = new Date()
) {
  await db
    .update(proactionFindings)
    .set({ deliveredAt: now, status: "delivered", updatedAt: now })
    .where(
      and(
        eq(proactionFindings.runId, runId),
        eq(proactionFindings.status, "new")
      )
    );
}

export async function listFindings(scope: AccessScope, limit = 30) {
  return db
    .select()
    .from(proactionFindings)
    .where(eq(proactionFindings.workspaceId, scope.workspaceId))
    .orderBy(desc(proactionFindings.createdAt))
    .limit(limit);
}

export async function recentFingerprints(
  scope: AccessScope,
  proactionId: string,
  limit = 25
) {
  return db
    .select({
      createdAt: proactionFindings.createdAt,
      fingerprint: proactionFindings.fingerprint,
      status: proactionFindings.status,
      summary: proactionFindings.summary,
    })
    .from(proactionFindings)
    .where(
      and(
        eq(proactionFindings.workspaceId, scope.workspaceId),
        eq(proactionFindings.proactionId, proactionId)
      )
    )
    .orderBy(desc(proactionFindings.createdAt))
    .limit(limit);
}

export async function resolveFinding(
  scope: AccessScope,
  findingId: string,
  status: "acted" | "dismissed",
  now = new Date()
) {
  const [finding] = await db
    .update(proactionFindings)
    .set({
      actionStatus:
        status === "acted"
          ? "completed"
          : sql`${proactionFindings.actionStatus}`,
      status,
      updatedAt: now,
    })
    .where(
      and(
        eq(proactionFindings.id, findingId),
        eq(proactionFindings.workspaceId, scope.workspaceId)
      )
    )
    .returning();
  return finding;
}
