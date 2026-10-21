import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, memoryModelUsage, workspaces } from "@db";
import type { AccessScope } from "@shared/identity/access-scope";
import { env } from "@shared/environment";
import { requireMemoryJobLease } from "./jobs";
import { requireMemoryMembership } from "./scope";

const tokenCount = z.number().int().min(0).max(2_147_483_647);

export class MemoryRequestTooLargeError extends Error {
  constructor() {
    super(
      "This memory extraction exceeds the workspace's daily token allowance."
    );
    this.name = "MemoryRequestTooLargeError";
  }
}

export class MemoryBudgetExceededError extends Error {
  constructor(readonly retryAt: Date) {
    super("The workspace memory extraction budget is exhausted.");
    this.name = "MemoryBudgetExceededError";
  }
}

export async function reserveMemoryModelUsage(
  scope: AccessScope,
  scopeKey: string,
  job: { id: string; leaseToken: string },
  input: { modelId: string; reservedTokens: number }
) {
  const reservedTokens = tokenCount.min(1).parse(input.reservedTokens);
  const modelId = z.string().min(1).max(256).parse(input.modelId);
  return db.transaction(async (transaction) => {
    const claimed = await requireMemoryJobLease(
      transaction,
      scope,
      scopeKey,
      job.id,
      job.leaseToken
    );
    await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, scope.workspaceId))
      .for("no key update");
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const [existing] = await transaction
      .select()
      .from(memoryModelUsage)
      .where(
        and(
          eq(memoryModelUsage.workspaceId, scope.workspaceId),
          eq(memoryModelUsage.jobId, job.id),
          eq(memoryModelUsage.leaseToken, job.leaseToken)
        )
      )
      .limit(1);
    if (existing)
      throw new Error("This memory attempt already reserved a model call.");
    if (
      env.KNOWLEDGE_MEMORY_DAILY_CALLS > 0 &&
      env.KNOWLEDGE_MEMORY_DAILY_TOKENS > 0 &&
      reservedTokens > env.KNOWLEDGE_MEMORY_DAILY_TOKENS
    )
      throw new MemoryRequestTooLargeError();
    const [usage] = await transaction
      .select({
        calls: sql<number>`count(*)`.mapWith(Number),
        tokens:
          sql<number>`coalesce(sum(${memoryModelUsage.chargedTokens}), 0)`.mapWith(
            Number
          ),
      })
      .from(memoryModelUsage)
      .where(
        and(
          eq(memoryModelUsage.workspaceId, scope.workspaceId),
          eq(memoryModelUsage.day, day)
        )
      );
    if (
      (usage?.calls ?? 0) >= env.KNOWLEDGE_MEMORY_DAILY_CALLS ||
      (usage?.tokens ?? 0) + reservedTokens > env.KNOWLEDGE_MEMORY_DAILY_TOKENS
    )
      throw new MemoryBudgetExceededError(
        new Date(new Date(`${day}T00:00:00.000Z`).getTime() + 86_400_000)
      );
    await transaction.insert(memoryModelUsage).values({
      workspaceId: scope.workspaceId,
      scopeKey,
      jobId: job.id,
      leaseToken: job.leaseToken,
      day,
      modelId,
      attempt: claimed.attempts,
      reservedTokens,
      chargedTokens: reservedTokens,
    });
  });
}

export async function completeMemoryModelUsage(
  scope: AccessScope,
  scopeKey: string,
  job: { id: string; leaseToken: string },
  input: {
    outcome: "succeeded" | "failed";
    acceptedClaims?: number;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
    responseModelId?: string;
    provider?: string;
  }
) {
  const count = (value: number | undefined) => {
    const parsed = tokenCount.safeParse(value);
    return parsed.success ? parsed.data : null;
  };
  const inputTokens = count(input.usage?.inputTokens);
  const outputTokens = count(input.usage?.outputTokens);
  const totalTokens = count(input.usage?.totalTokens);
  const complete =
    totalTokens !== null || (inputTokens !== null && outputTokens !== null);
  const known = Math.max(
    totalTokens ?? 0,
    (inputTokens ?? 0) + (outputTokens ?? 0)
  );
  await db.transaction(async (transaction) => {
    await requireMemoryMembership(scope, transaction);
    await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, scope.workspaceId))
      .for("no key update");
    await transaction
      .update(memoryModelUsage)
      .set({
        status: complete ? "reported" : "unknown",
        outcome: input.outcome,
        acceptedClaims:
          input.acceptedClaims === undefined
            ? null
            : z.number().int().min(0).max(12).parse(input.acceptedClaims),
        inputTokens,
        outputTokens,
        totalTokens,
        responseModelId: input.responseModelId?.slice(0, 256) ?? null,
        provider: input.provider?.slice(0, 256) ?? null,
        chargedTokens: complete
          ? known
          : sql`greatest(${memoryModelUsage.reservedTokens}, ${known})`,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(memoryModelUsage.workspaceId, scope.workspaceId),
          eq(memoryModelUsage.scopeKey, scopeKey),
          eq(memoryModelUsage.jobId, job.id),
          eq(memoryModelUsage.leaseToken, job.leaseToken),
          eq(memoryModelUsage.status, "reserved")
        )
      );
  });
}

export async function readMemoryModelUsage(
  scope: AccessScope,
  day = new Date().toISOString().slice(0, 10)
) {
  z.iso.date().parse(day);
  await requireMemoryMembership(scope);
  const [usage] = await db
    .select({
      calls: sql<number>`count(*)`.mapWith(Number),
      chargedTokens:
        sql<number>`coalesce(sum(${memoryModelUsage.chargedTokens}), 0)`.mapWith(
          Number
        ),
      inputTokens:
        sql<number>`coalesce(sum(${memoryModelUsage.inputTokens}), 0)`.mapWith(
          Number
        ),
      outputTokens:
        sql<number>`coalesce(sum(${memoryModelUsage.outputTokens}), 0)`.mapWith(
          Number
        ),
      totalTokens:
        sql<number>`coalesce(sum(${memoryModelUsage.totalTokens}), 0)`.mapWith(
          Number
        ),
      reservedCalls:
        sql<number>`count(*) filter (where ${memoryModelUsage.status} = 'reserved')`.mapWith(
          Number
        ),
      reservedTokens:
        sql<number>`coalesce(sum(${memoryModelUsage.chargedTokens}) filter (where ${memoryModelUsage.status} = 'reserved'), 0)`.mapWith(
          Number
        ),
      unknownCalls:
        sql<number>`count(*) filter (where ${memoryModelUsage.status} = 'unknown')`.mapWith(
          Number
        ),
      unknownTokens:
        sql<number>`coalesce(sum(${memoryModelUsage.chargedTokens}) filter (where ${memoryModelUsage.status} = 'unknown'), 0)`.mapWith(
          Number
        ),
      emptyCalls:
        sql<number>`count(*) filter (where ${memoryModelUsage.acceptedClaims} = 0)`.mapWith(
          Number
        ),
      emptyTokens:
        sql<number>`coalesce(sum(${memoryModelUsage.chargedTokens}) filter (where ${memoryModelUsage.acceptedClaims} = 0), 0)`.mapWith(
          Number
        ),
      retryCalls:
        sql<number>`count(*) filter (where ${memoryModelUsage.attempt} > 1)`.mapWith(
          Number
        ),
      retryTokens:
        sql<number>`coalesce(sum(${memoryModelUsage.chargedTokens}) filter (where ${memoryModelUsage.attempt} > 1), 0)`.mapWith(
          Number
        ),
      succeededCalls:
        sql<number>`count(*) filter (where ${memoryModelUsage.outcome} = 'succeeded')`.mapWith(
          Number
        ),
      failedCalls:
        sql<number>`count(*) filter (where ${memoryModelUsage.outcome} = 'failed')`.mapWith(
          Number
        ),
    })
    .from(memoryModelUsage)
    .where(
      and(
        eq(memoryModelUsage.workspaceId, scope.workspaceId),
        eq(memoryModelUsage.day, day)
      )
    );
  if (!usage) throw new Error("Memory usage could not be read.");
  return {
    day,
    ...usage,
    tokenLimit: env.KNOWLEDGE_MEMORY_DAILY_TOKENS,
    callLimit: env.KNOWLEDGE_MEMORY_DAILY_CALLS,
    remainingTokens: Math.max(
      0,
      env.KNOWLEDGE_MEMORY_DAILY_TOKENS - usage.chargedTokens
    ),
    remainingCalls: Math.max(0, env.KNOWLEDGE_MEMORY_DAILY_CALLS - usage.calls),
  };
}
