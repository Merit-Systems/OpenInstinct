import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import type { AccessScope } from "@/lib/access-scope";
import { isWorkspaceScopeEnforcementEnabled } from "@/env";
import { db, type UsageEventKind, usageEvents, workspaceBudgets } from "@/db";
import { recordAuditEvent } from "./audit";
import { assertWorkspaceOperable } from "./scope";

export class BudgetExceededError extends Error {
  constructor(
    readonly kind: UsageEventKind,
    readonly limit: number
  ) {
    super("Workspace usage limit reached. Please try again later.");
    this.name = "BudgetExceededError";
  }
}

export async function recordUsageEvent(
  scope: AccessScope,
  event: {
    readonly kind: UsageEventKind;
    readonly quantity: number;
    readonly unit: string;
    readonly costEstimateUsd?: number | null;
    readonly createdAt?: string;
    readonly metadata?: unknown;
    readonly sessionId?: string;
    readonly userId?: string | null;
  }
) {
  await db.insert(usageEvents).values({
    costEstimateUsd: event.costEstimateUsd,
    createdAt: event.createdAt,
    id: randomUUID(),
    kind: event.kind,
    metadata: event.metadata,
    quantity: event.quantity,
    sessionId: event.sessionId,
    unit: event.unit,
    userId: event.userId ?? scope.userId,
    workspaceId: scope.workspaceId,
  });
}

export async function sumUsageSince(
  scope: AccessScope,
  kind: UsageEventKind,
  sinceIso: string
) {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${usageEvents.quantity}), 0)` })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.workspaceId, scope.workspaceId),
        eq(usageEvents.kind, kind),
        gte(usageEvents.createdAt, sinceIso)
      )
    );
  return row?.total ?? 0;
}

const budgetLimitColumn = {
  browser_session: workspaceBudgets.browserSessionLimit,
  model_tokens: workspaceBudgets.modelTokenLimit,
  provider_message: workspaceBudgets.messageLimit,
  storage_bytes: undefined,
} as const;

export async function checkBudget(scope: AccessScope, kind: UsageEventKind) {
  if (!isWorkspaceScopeEnforcementEnabled()) return;
  await assertWorkspaceOperable(scope);
  try {
    const limitColumn = budgetLimitColumn[kind];
    if (!limitColumn) return;

    const [budget] = await db
      .select({ limit: limitColumn })
      .from(workspaceBudgets)
      .where(eq(workspaceBudgets.workspaceId, scope.workspaceId))
      .limit(1);
    const limit = budget?.limit;
    if (limit === null || limit === undefined) return;

    const used = await sumUsageSince(scope, kind, startOfCurrentUtcMonthIso());
    if (used < limit) return;
    try {
      await recordAuditEvent(scope, {
        action: "usage.budget.check",
        metadata: { kind },
        outcome: "denied",
      });
    } catch {
      console.warn("[audit] event recording failed");
    }
    throw new BudgetExceededError(kind, limit);
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    console.warn("[usage] budget check failed");
  }
}

// Budget periods follow calendar months in UTC.
function startOfCurrentUtcMonthIso() {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString();
}
