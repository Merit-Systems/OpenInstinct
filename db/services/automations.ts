import { and, desc, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { automationRuns, automations, db, gmailWatches } from "@/db";
import type { AccessScope } from "@/lib/access-scope";
import {
  automationSchema,
  automationStatusSchema,
  automationTriggerSchema,
  nextAutomationRunAt,
  type Automation,
  type AutomationTrigger,
} from "@/lib/automation";
import { ensureScope } from "./scope";

const automationRowSchema = automationSchema.omit({ trigger: true }).extend({
  trigger: z.string(),
});

const gmailWatchSchema = z.object({
  createdAt: z.string(),
  emailAddress: z.string().nullable(),
  expirationAt: z.string().nullable(),
  generation: z.number().int().positive(),
  historyId: z.string().nullable(),
  status: z.enum(["arming", "active", "paused", "failed"]),
  updatedAt: z.string(),
  userId: z.string().min(1),
  workflowRunId: z.string().nullable(),
  workspaceId: z.string().min(1),
});

export interface CreateAutomationInput {
  readonly idempotencyKey: string;
  readonly phoneNumber: string;
  readonly sessionId: string;
  readonly task: string;
  readonly timezone: string;
  readonly title: string;
  readonly trigger: AutomationTrigger;
}

export async function createAutomation(
  scope: AccessScope,
  input: CreateAutomationInput
) {
  await ensureScope(scope);
  const now = new Date();
  const trigger = automationTriggerSchema.parse(input.trigger);
  const nextRunAt = nextAutomationRunAt(trigger, input.timezone, now);
  if (trigger.kind !== "gmail" && !nextRunAt) {
    throw new Error("The automation's first run must be in the future.");
  }
  const row = {
    createdAt: now.toISOString(),
    createdByUserId: scope.userId,
    id: nanoid(),
    idempotencyKey: input.idempotencyKey,
    nextRunAt: nextRunAt?.toISOString() ?? null,
    phoneNumber: input.phoneNumber,
    revision: 1,
    sessionId: input.sessionId,
    status: "active",
    task: input.task,
    timezone: input.timezone,
    title: input.title,
    trigger: JSON.stringify(trigger),
    updatedAt: now.toISOString(),
    workspaceId: scope.workspaceId,
  } as const;
  const inserted = await db
    .insert(automations)
    .values(row)
    .onConflictDoNothing({
      target: [automations.workspaceId, automations.idempotencyKey],
    })
    .returning();
  if (inserted[0]) return parseAutomation(inserted[0]);

  const existing = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspaceId, scope.workspaceId),
        eq(automations.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  const existingRow = existing[0];
  if (!existingRow) {
    throw new Error("The saved automation could not be read after a conflict.");
  }
  const automation = parseAutomation(existingRow);
  if (
    automation.sessionId !== input.sessionId ||
    automation.task !== input.task ||
    JSON.stringify(automation.trigger) !== JSON.stringify(trigger)
  ) {
    throw new Error("This automation idempotency key is already in use.");
  }
  return automation;
}

export async function listAutomations(scope: AccessScope) {
  const rows = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspaceId, scope.workspaceId),
        ne(automations.status, "deleted")
      )
    )
    .orderBy(desc(automations.createdAt));
  return rows.map(parseAutomation);
}

export async function readAutomationById(id: string) {
  const rows = await db
    .select()
    .from(automations)
    .where(eq(automations.id, id))
    .limit(1);
  return rows[0] ? parseAutomation(rows[0]) : undefined;
}

export async function readAutomationRunById(id: string) {
  const rows = await db
    .select({
      automationId: automationRuns.automationId,
      eveSessionId: automationRuns.eveSessionId,
      revision: automationRuns.revision,
      status: automationRuns.status,
    })
    .from(automationRuns)
    .where(eq(automationRuns.id, id))
    .limit(1);
  return rows[0];
}

export async function setAutomationStatus(
  scope: AccessScope,
  id: string,
  requestedStatus: "active" | "paused" | "deleted"
) {
  const now = new Date();
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.workspaceId, scope.workspaceId),
          eq(automations.id, id)
        )
      )
      .for("update")
      .limit(1);
    const current = rows[0] ? parseAutomation(rows[0]) : undefined;
    if (!current) return undefined;
    if (current.status === "deleted") return current;

    const status = automationStatusSchema.parse(requestedStatus);
    const nextRunAt =
      status === "active"
        ? (nextAutomationRunAt(
            current.trigger,
            current.timezone,
            now
          )?.toISOString() ?? null)
        : null;
    if (status === "active" && current.trigger.kind !== "gmail" && !nextRunAt) {
      throw new Error("This one-time automation has already passed.");
    }
    const updated = await transaction
      .update(automations)
      .set({
        nextRunAt,
        revision: current.revision + 1,
        status,
        updatedAt: now.toISOString(),
      })
      .where(eq(automations.id, id))
      .returning();
    const updatedRow = updated[0];
    if (!updatedRow) throw new Error("The automation could not be updated.");
    return parseAutomation(updatedRow);
  });
}

export async function beginAutomationRun(
  automationId: string,
  revision: number,
  triggerKey: string
) {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select()
      .from(automations)
      .where(eq(automations.id, automationId))
      .for("update")
      .limit(1);
    const automation = rows[0] ? parseAutomation(rows[0]) : undefined;
    if (automation?.status !== "active" || automation.revision !== revision) {
      return undefined;
    }

    const startedAt = new Date().toISOString();
    const inserted = await transaction
      .insert(automationRuns)
      .values({
        automationId,
        id: nanoid(),
        revision,
        startedAt,
        triggerKey,
      })
      .onConflictDoNothing({
        target: [automationRuns.automationId, automationRuns.triggerKey],
      })
      .returning({ id: automationRuns.id });
    const run = inserted[0];
    return run ? { automation, runId: run.id, startedAt } : undefined;
  });
}

export async function finishAutomationRun({
  error,
  result,
  runId,
}: {
  readonly error?: string;
  readonly result?: string;
  readonly runId: string;
}) {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select({
        automation: automations,
        runRevision: automationRuns.revision,
        runStatus: automationRuns.status,
      })
      .from(automationRuns)
      .innerJoin(automations, eq(automations.id, automationRuns.automationId))
      .where(eq(automationRuns.id, runId))
      .for("update")
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error(`Automation run ${runId} was not found.`);
    const automation = parseAutomation(row.automation);
    if (row.runStatus !== "running") return automation;

    const completedAt = new Date();
    await transaction
      .update(automationRuns)
      .set({
        completedAt: completedAt.toISOString(),
        error: error ?? null,
        result: result ?? null,
        status: error === undefined ? "completed" : "failed",
      })
      .where(eq(automationRuns.id, runId));

    if (
      automation.status !== "active" ||
      automation.revision !== row.runRevision
    ) {
      return automation;
    }

    if (automation.trigger.kind === "gmail") {
      await transaction
        .update(automations)
        .set({
          lastRunAt: completedAt.toISOString(),
          updatedAt: completedAt.toISOString(),
        })
        .where(eq(automations.id, automation.id));
      return automation;
    }

    const nextRunAt = nextAutomationRunAt(
      automation.trigger,
      automation.timezone,
      completedAt
    );
    const status = nextRunAt ? "active" : "completed";
    const updated = await transaction
      .update(automations)
      .set({
        lastRunAt: completedAt.toISOString(),
        nextRunAt: nextRunAt?.toISOString() ?? null,
        status,
        updatedAt: completedAt.toISOString(),
      })
      .where(
        and(
          eq(automations.id, automation.id),
          eq(automations.revision, automation.revision)
        )
      )
      .returning();
    return updated[0] ? parseAutomation(updated[0]) : automation;
  });
}

export async function recordAutomationEveSession(
  runId: string,
  eveSessionId: string
) {
  const updated = await db
    .update(automationRuns)
    .set({ eveSessionId })
    .where(
      and(
        eq(automationRuns.id, runId),
        sql`${automationRuns.eveSessionId} IS NULL OR ${automationRuns.eveSessionId} = ${eveSessionId}`
      )
    )
    .returning({ eveSessionId: automationRuns.eveSessionId });
  const sessionId = updated[0]?.eveSessionId;
  if (sessionId !== eveSessionId) {
    throw new Error("The automation run is owned by another Eve session.");
  }
}

export async function listActiveGmailAutomations(
  workspaceId: string,
  userId: string
) {
  const rows = await db
    .select()
    .from(automations)
    .where(
      and(
        eq(automations.workspaceId, workspaceId),
        eq(automations.createdByUserId, userId),
        eq(automations.status, "active"),
        sql`${automations.trigger}::jsonb ->> 'kind' = 'gmail'`
      )
    );
  return rows.map(parseAutomation);
}

export async function prepareGmailWatch(scope: AccessScope) {
  await ensureScope(scope);
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select()
      .from(gmailWatches)
      .where(
        and(
          eq(gmailWatches.workspaceId, scope.workspaceId),
          eq(gmailWatches.userId, scope.userId)
        )
      )
      .for("update")
      .limit(1);
    const existing = rows[0] ? gmailWatchSchema.parse(rows[0]) : undefined;
    const sufficientlyFresh =
      existing?.status === "active" &&
      existing.expirationAt !== null &&
      new Date(existing.expirationAt).getTime() >
        Date.now() + 24 * 60 * 60 * 1000;
    if (sufficientlyFresh) {
      return { generation: existing.generation, startRequired: false } as const;
    }

    const now = new Date().toISOString();
    const generation = (existing?.generation ?? 0) + 1;
    const status = existing?.status === "active" ? "active" : "arming";
    await transaction
      .insert(gmailWatches)
      .values({
        createdAt: existing?.createdAt ?? now,
        generation,
        status,
        updatedAt: now,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      })
      .onConflictDoUpdate({
        set: {
          generation,
          status,
          updatedAt: now,
          workflowRunId: null,
        },
        target: [gmailWatches.workspaceId, gmailWatches.userId],
      });
    return { generation, startRequired: true } as const;
  });
}

export async function recordGmailWatchWorkflow(
  scope: AccessScope,
  generation: number,
  workflowRunId: string
) {
  await db
    .update(gmailWatches)
    .set({ workflowRunId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(gmailWatches.workspaceId, scope.workspaceId),
        eq(gmailWatches.userId, scope.userId),
        eq(gmailWatches.generation, generation)
      )
    );
}

export async function activateGmailWatch({
  emailAddress,
  expirationAt,
  generation,
  historyId,
  scope,
}: {
  readonly emailAddress: string;
  readonly expirationAt: string;
  readonly generation: number;
  readonly historyId: string;
  readonly scope: AccessScope;
}) {
  const updated = await db
    .update(gmailWatches)
    .set({
      emailAddress,
      expirationAt,
      historyId: sql`coalesce(${gmailWatches.historyId}, ${historyId})`,
      status: "active",
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(gmailWatches.workspaceId, scope.workspaceId),
        eq(gmailWatches.userId, scope.userId),
        eq(gmailWatches.generation, generation)
      )
    )
    .returning();
  return updated[0] ? gmailWatchSchema.parse(updated[0]) : undefined;
}

export async function readGmailWatchByEmail(emailAddress: string) {
  const rows = await db
    .select()
    .from(gmailWatches)
    .where(eq(gmailWatches.emailAddress, emailAddress))
    .limit(1);
  return rows[0] ? gmailWatchSchema.parse(rows[0]) : undefined;
}

export async function advanceGmailHistory(
  workspaceId: string,
  userId: string,
  historyId: string
) {
  return db.transaction(async (transaction) => {
    const rows = await transaction
      .select()
      .from(gmailWatches)
      .where(
        and(
          eq(gmailWatches.workspaceId, workspaceId),
          eq(gmailWatches.userId, userId)
        )
      )
      .for("update")
      .limit(1);
    const current = rows[0] ? gmailWatchSchema.parse(rows[0]) : undefined;
    if (!current) return undefined;
    if (
      current.historyId !== null &&
      BigInt(historyId) <= BigInt(current.historyId)
    ) {
      return current;
    }
    const updated = await transaction
      .update(gmailWatches)
      .set({ historyId, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(gmailWatches.workspaceId, workspaceId),
          eq(gmailWatches.userId, userId)
        )
      )
      .returning();
    return gmailWatchSchema.parse(updated[0]);
  });
}

function parseAutomation(row: typeof automations.$inferSelect): Automation {
  const parsed = automationRowSchema.parse(row);
  const trigger: unknown = JSON.parse(parsed.trigger);
  return automationSchema.parse({
    ...parsed,
    trigger,
  });
}
