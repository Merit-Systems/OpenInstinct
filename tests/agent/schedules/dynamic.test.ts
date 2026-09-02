import type { Session } from "eve/channels";
import type { ScheduleHandlerArgs, ScheduleToFn } from "eve/schedules";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  claimReadyScheduledAgentRuns,
  claimScheduledReport,
  listRecoverableScheduledReports,
  materializeDueScheduledAgentRuns,
  releaseScheduledAgentRun,
  releaseScheduledReport,
  setScheduledRunSession,
} from "@/db/services/scheduled-agent-jobs";

const services = vi.hoisted(() => ({
  claimReports: vi.fn<typeof claimScheduledReport>(),
  claimRuns: vi.fn<typeof claimReadyScheduledAgentRuns>(),
  listReports: vi.fn<typeof listRecoverableScheduledReports>(),
  materialize: vi.fn<typeof materializeDueScheduledAgentRuns>(),
  releaseReport: vi.fn<typeof releaseScheduledReport>(),
  releaseRun: vi.fn<typeof releaseScheduledAgentRun>(),
  setSession: vi.fn<typeof setScheduledRunSession>(),
}));

vi.mock("@/db/services/scheduled-agent-jobs", () => ({
  claimReadyScheduledAgentRuns: services.claimRuns,
  claimScheduledReport: services.claimReports,
  listRecoverableScheduledReports: services.listReports,
  materializeDueScheduledAgentRuns: services.materialize,
  releaseScheduledAgentRun: services.releaseRun,
  releaseScheduledReport: services.releaseReport,
  setScheduledRunSession: services.setSession,
}));
vi.mock("@/agent/channels/linq", () => ({ default: { channel: "linq" } }));
vi.mock("@/agent/channels/scheduled-run", () => ({
  default: { channel: "scheduled-run" },
}));

import dynamicSchedule from "@/agent/schedules/dynamic";

describe("dynamic schedule dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    services.materialize.mockResolvedValue([]);
    services.listReports.mockResolvedValue([]);
    services.claimRuns.mockResolvedValue([]);
  });

  it("starts due work separately without waiting for its lifetime", async () => {
    const claim = scheduledClaim();
    services.claimRuns.mockResolvedValue([claim]);
    const workerSend = vi
      .fn<ReturnType<ScheduleToFn>["send"]>()
      .mockResolvedValue(workerSession());
    const linqSend = vi.fn<ReturnType<ScheduleToFn>["send"]>();
    const to = vi.fn<ScheduleToFn>((channel) => ({
      send:
        "channel" in channel && channel.channel === "scheduled-run"
          ? workerSend
          : linqSend,
    }));

    await runSchedule(to);

    expect(workerSend).toHaveBeenCalledOnce();
    expect(workerSend.mock.calls[0]?.[0]).toContain(
      "Do not communicate with the user"
    );
    expect(services.setSession).toHaveBeenCalledWith(
      claim.run.id,
      claim.run.leaseToken,
      "worker-session"
    );
    expect(to).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ restart: false, runId: claim.run.id })
    );
    expect(linqSend).not.toHaveBeenCalled();
  });

  it("requests a clean restart for a reclaimed interrupted worker", async () => {
    const claim = scheduledClaim();
    claim.run.workerSessionId = "interrupted-worker-session";
    services.claimRuns.mockResolvedValue([claim]);
    const workerSend = vi
      .fn<ReturnType<ScheduleToFn>["send"]>()
      .mockResolvedValue(workerSession("replacement-worker-session"));
    const to = vi.fn<ScheduleToFn>(() => ({ send: workerSend }));

    await runSchedule(to);

    expect(to).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ restart: true, runId: claim.run.id })
    );
  });

  it("recovers a pending report through the main Linq continuation", async () => {
    const report = scheduledReport();
    services.listReports.mockResolvedValue([report.run.id]);
    services.claimReports.mockResolvedValue(report);
    const workerSend = vi.fn<ReturnType<ScheduleToFn>["send"]>();
    const linqSend = vi
      .fn<ReturnType<ScheduleToFn>["send"]>()
      .mockResolvedValue(workerSession("main-session"));
    const to = vi.fn<ScheduleToFn>((channel) => ({
      send:
        "channel" in channel && channel.channel === "scheduled-run"
          ? workerSend
          : linqSend,
    }));

    await runSchedule(to);

    expect(workerSend).not.toHaveBeenCalled();
    expect(linqSend).toHaveBeenCalledOnce();
    expect(linqSend.mock.calls[0]?.[1]).toMatchObject({
      auth: { authenticator: "scheduled-result" },
      turnPolicy: "queue",
    });
  });
});

async function runSchedule(to: ScheduleToFn) {
  let task: Promise<unknown> | undefined;
  const args: ScheduleHandlerArgs = {
    appAuth: {
      attributes: {},
      authenticator: "test",
      principalId: "test-app",
      principalType: "app",
    },
    to,
    waitUntil(backgroundTask) {
      task = backgroundTask;
    },
  };
  dynamicSchedule.run(args);
  await task;
}

const resultOutcome = {
  kind: "result" as const,
  summary: "The price fell to $250.",
  urgency: "normal" as const,
};

function workerSession(id = "worker-session"): Session {
  return {
    cancel: vi.fn<Session["cancel"]>(),
    clear: vi.fn<Session["clear"]>(),
    compact: vi.fn<Session["compact"]>(),
    getEventStream: vi.fn<Session["getEventStream"]>(),
    getStreamTailIndex: vi.fn<Session["getStreamTailIndex"]>(),
    id,
    reset: vi.fn<Session["reset"]>(),
    respond: vi.fn<Session["respond"]>(),
    send: vi.fn<Session["send"]>(),
  };
}

function scheduledClaim(): Awaited<
  ReturnType<typeof claimReadyScheduledAgentRuns>
>[number] {
  return {
    job: {
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      createdByUserId: "user-1",
      id: "00000000-0000-4000-8000-000000000001",
      lastError: null,
      lastRunAt: new Date("2026-09-02T13:00:00.000Z"),
      linqThreadId: "linq:dm:chat-1",
      missedRunPolicy: "run_latest",
      nextRunAt: new Date("2026-09-03T13:00:00.000Z"),
      prompt: "Watch the price.",
      revision: 0,
      status: "active",
      timing: {
        frequency: "daily",
        kind: "calendar",
        localTime: "09:00",
        timezone: "America/New_York",
      },
      updatedAt: new Date("2026-09-01T12:00:00.000Z"),
      workspaceId: "workspace-1",
    },
    run: {
      attempts: 1,
      completedAt: null,
      createdAt: new Date("2026-09-02T13:00:00.000Z"),
      id: "00000000-0000-4000-8000-000000000002",
      jobId: "00000000-0000-4000-8000-000000000001",
      lastError: null,
      leaseExpiresAt: new Date("2026-09-02T13:05:00.000Z"),
      leaseToken: "00000000-0000-4000-8000-000000000003",
      outcome: null,
      reportStatus: "not_ready",
      retryAt: null,
      scheduledFor: new Date("2026-09-02T13:00:00.000Z"),
      startedAt: new Date("2026-09-02T13:00:00.000Z"),
      status: "running",
      updatedAt: new Date("2026-09-02T13:00:00.000Z"),
      workerSessionId: null,
    },
  };
}

function scheduledReport(): NonNullable<
  Awaited<ReturnType<typeof claimScheduledReport>>
> {
  const claim = scheduledClaim();
  return {
    job: claim.job,
    run: {
      ...claim.run,
      outcome: resultOutcome,
      reportStatus: "queued",
      status: "completed",
    },
  };
}
