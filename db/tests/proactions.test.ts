import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@/db";
import type * as GoogleWorkspace from "@/lib/google-workspace";
import * as schema from "../schema";
import { applyAllMigrations } from "./helpers/migrations";

const databases: PGlite[] = [];
const google = vi.hoisted(() => ({
  // SAFETY: Tests reassign this through the same connection-state union.
  state: "disconnected" as GoogleWorkspace.GoogleWorkspaceConnection["state"],
}));

vi.mock("@/lib/google-workspace", async (importOriginal) => {
  const original = await importOriginal<typeof GoogleWorkspace>();
  return {
    ...original,
    readGoogleWorkspaceConnection: async () => ({
      accountLabel: null,
      state: google.state,
    }),
  };
});

afterEach(async () => {
  vi.restoreAllMocks();
  google.state = "disconnected";
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("proactions", () => {
  it("activates system jobs as prerequisites and policy allow, and keeps them out of user schedules", async () => {
    await useDatabase();
    const scope = await import("@/db/services/scope");
    const jobs = await import("@/db/services/scheduled-agent-jobs");
    const policies = await import("@/db/services/proaction-policies");
    const settings = await import("@/db/services/proaction-settings");
    const { reconcileProactions } =
      await import("@/agent/lib/proactions/reconcile");
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    await scope.ensureScope(alice);
    const now = new Date("2026-09-01T12:00:00.000Z");

    const { entries: first } = await reconcileProactions(alice, now);
    expect(
      first.map((entry) => [entry.definition.id, entry.job.status])
    ).toEqual([
      ["tomorrow-brief", "paused"],
      ["flight-price-watch", "paused"],
      ["bill-savings", "paused"],
      ["card-rewards-nudge", "paused"],
    ]);
    expect(first[0]?.job.conversationChannel).toBe("eve");
    expect(first[0]?.job.conversationId).toBe("proactions:workspace:alice");
    expect(first[0]?.readiness.missing).toEqual(["google"]);

    google.state = "connected";
    const { entries: connected } = await reconcileProactions(alice, now);
    expect(
      connected.map((entry) => [entry.definition.id, entry.job.status])
    ).toEqual([
      ["tomorrow-brief", "active"],
      ["flight-price-watch", "active"],
      ["bill-savings", "active"],
      ["card-rewards-nudge", "paused"],
    ]);
    expect(connected[3]?.readiness.missing).toEqual(["paymentCard"]);
    expect(connected[0]?.job.nextRunAt?.toISOString()).toBe(
      "2026-09-02T08:00:00.000Z"
    );

    // The same rows are reused and untouched on an idempotent reconcile.
    const { entries: again } = await reconcileProactions(
      alice,
      new Date(now.getTime() + 60_000)
    );
    expect(again.map((entry) => entry.job.id)).toEqual(
      connected.map((entry) => entry.job.id)
    );
    expect(again[0]?.job.revision).toBe(connected[0]?.job.revision);

    // A remembered iMessage thread becomes the home conversation.
    expect(await settings.rememberLinqThread(alice, "linq:dm:alice")).toBe(
      true
    );
    expect(await settings.rememberLinqThread(alice, "linq:dm:alice")).toBe(
      false
    );
    const { entries: homed } = await reconcileProactions(alice, now);
    expect(homed[0]?.job).toMatchObject({
      conversationChannel: "linq",
      conversationId: "linq:dm:alice",
    });

    // The user turns one off; the job pauses without losing its row.
    await policies.saveProactionPolicy(alice, "bill-savings", {
      enabled: false,
    });
    const { entries: paused } = await reconcileProactions(alice, now);
    expect(paused[2]?.job).toMatchObject({ nextRunAt: null, status: "paused" });
    expect(paused[2]?.policy.enabled).toBe(false);

    // Brief time changes recompute calendar cadences.
    await settings.saveProactionSettings(alice, {
      briefLocalTime: "06:15",
      timezone: "America/New_York",
    });
    const { entries: rescheduled } = await reconcileProactions(alice, now);
    expect(rescheduled[0]?.job.nextRunAt?.toISOString()).toBe(
      "2026-09-02T10:15:00.000Z"
    );

    // Interactive schedule tools never see system jobs.
    expect(
      await jobs.listScheduledAgentJobs(alice, {
        conversationChannel: "linq",
        conversationId: "linq:dm:alice",
      })
    ).toEqual([]);
    expect(
      await jobs.updateScheduledAgentJob(
        alice,
        { conversationChannel: "linq", conversationId: "linq:dm:alice" },
        rescheduled[0]?.job.id ?? "",
        { status: "deleted" }
      )
    ).toBeUndefined();
  }, 20_000);

  it("dedupes findings by fingerprint inside the cooldown and tracks delivery", async () => {
    await useDatabase();
    const scope = await import("@/db/services/scope");
    const findings = await import("@/db/services/proaction-findings");
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    await scope.ensureScope(alice);
    const now = new Date("2026-09-01T12:00:00.000Z");
    const input = {
      actionStatus: "proposed" as const,
      fingerprint: "UA:ABC123:250",
      proposedAction: "Rebook for a $60 credit.",
      summary: "SFO-JFK dropped from $310 to $250.",
      urgency: "time_sensitive" as const,
    };

    const first = await findings.recordFinding(
      alice,
      "flight-price-watch",
      null,
      input,
      72,
      now
    );
    expect(first.status).toBe("recorded");
    const repeat = await findings.recordFinding(
      alice,
      "flight-price-watch",
      null,
      input,
      72,
      new Date(now.getTime() + 6 * 3_600_000)
    );
    expect(repeat).toMatchObject({
      finding: { id: first.finding.id },
      status: "duplicate",
    });

    const later = await findings.recordFinding(
      alice,
      "flight-price-watch",
      null,
      { ...input, summary: "Dropped again." },
      72,
      new Date(now.getTime() + 100 * 3_600_000)
    );
    expect(later.status).toBe("recorded");
    expect(later.finding.id).toBe(first.finding.id);
    expect(later.finding.summary).toBe("Dropped again.");

    expect(
      await findings.recentFingerprints(alice, "flight-price-watch")
    ).toEqual([
      expect.objectContaining({ fingerprint: "UA:ABC123:250", status: "new" }),
    ]);
    const dismissed = await findings.resolveFinding(
      alice,
      first.finding.id,
      "dismissed"
    );
    expect(dismissed?.status).toBe("dismissed");
    expect(
      await findings.resolveFinding(
        { userId: "bob", workspaceId: "workspace:bob" },
        first.finding.id,
        "acted"
      )
    ).toBeUndefined();
  }, 20_000);
});

async function useDatabase() {
  const client = new PGlite();
  databases.push(client);
  await applyAllMigrations(client);
  const pgliteDatabase = drizzle(client, { schema });
  // SAFETY: PGlite implements the query-builder surface exercised by these services while retaining the shared Drizzle schema.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The focused test swaps only the database driver.
  vi.spyOn(Database, "db", "get").mockReturnValue(pgliteDatabase as never);
}
