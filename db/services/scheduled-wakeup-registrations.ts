import { createHash } from "node:crypto";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db, scheduledWakeupRegistrations } from "@db";
import {
  scheduledWakeupSchema,
  type ScheduledWakeup,
} from "@shared/schedules/wakeups";

function registrationKey(wakeup: ScheduledWakeup) {
  wakeup = scheduledWakeupSchema.parse(wakeup);
  const value =
    wakeup.kind === "legacy-run"
      ? [wakeup.kind, wakeup.runId, wakeup.at]
      : wakeup;
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function claimScheduledWakeup(
  wakeup: ScheduledWakeup,
  owner: string,
  now = new Date()
) {
  const key = registrationKey(wakeup);
  const values = {
    key,
    owner,
    leaseExpiresAt: new Date(now.getTime() + 5 * 60_000),
  };
  const [claimed] = await db
    .insert(scheduledWakeupRegistrations)
    .values(values)
    .onConflictDoUpdate({
      target: scheduledWakeupRegistrations.key,
      set: { owner, leaseExpiresAt: values.leaseExpiresAt },
      setWhere: and(
        isNull(scheduledWakeupRegistrations.workflowRunId),
        or(
          eq(scheduledWakeupRegistrations.owner, owner),
          lte(scheduledWakeupRegistrations.leaseExpiresAt, now)
        )
      ),
    })
    .returning();
  if (claimed) return { key, claimed: true, workflowRunId: null };
  const existing = await db.query.scheduledWakeupRegistrations.findFirst({
    where: eq(scheduledWakeupRegistrations.key, key),
  });
  return {
    key,
    claimed: false,
    workflowRunId: existing?.workflowRunId ?? null,
  };
}

export async function recordScheduledWakeup(
  key: string,
  owner: string,
  workflowRunId: string
) {
  const rows = await db
    .update(scheduledWakeupRegistrations)
    .set({ workflowRunId })
    .where(
      and(
        eq(scheduledWakeupRegistrations.key, key),
        eq(scheduledWakeupRegistrations.owner, owner),
        isNull(scheduledWakeupRegistrations.workflowRunId)
      )
    )
    .returning({ key: scheduledWakeupRegistrations.key });
  return rows.length > 0;
}

export async function releaseScheduledWakeup(
  wakeup: ScheduledWakeup,
  workflowRunId: string
) {
  await db
    .delete(scheduledWakeupRegistrations)
    .where(
      and(
        eq(scheduledWakeupRegistrations.key, registrationKey(wakeup)),
        eq(scheduledWakeupRegistrations.workflowRunId, workflowRunId)
      )
    );
}
