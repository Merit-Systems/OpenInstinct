import { defineSchedule } from "eve/schedules";
import { asc, gt } from "drizzle-orm";
import { reconcileProactions } from "@/agent/lib/proactions/reconcile";
import { db, workspaceMemberships } from "@/db";

// Hourly sweep so a connection made in the web UI, a catalog change, or an
// admin policy change activates or pauses proactions without a chat session.
export default defineSchedule({
  cron: "17 * * * *",
  run({ waitUntil }) {
    waitUntil(reconcileAllWorkspaces());
  },
});

async function reconcileAllWorkspaces() {
  const now = new Date();
  let cursor = "";
  let reconciled = 0;
  let failed = 0;
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Workspaces are paged sequentially to bound memory.
    const page = await db
      .select({
        userId: workspaceMemberships.userId,
        workspaceId: workspaceMemberships.workspaceId,
      })
      .from(workspaceMemberships)
      .where(gt(workspaceMemberships.workspaceId, cursor))
      .orderBy(asc(workspaceMemberships.workspaceId))
      .limit(100);
    if (page.length === 0) break;
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each page completes before the next is fetched.
    const results = await Promise.allSettled(
      page.map((scope) => reconcileProactions(scope, now))
    );
    for (const result of results) {
      if (result.status === "fulfilled") reconciled += 1;
      else failed += 1;
    }
    cursor = page.at(-1)?.workspaceId ?? cursor;
  }
  console.info("[proactions] hourly reconcile", { failed, reconciled });
}
