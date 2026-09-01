import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookContext } from "eve/hooks";
import type {
  completeScheduledAgentRun,
  releaseScheduledAgentRun,
} from "@/db/services/scheduled-agent-jobs";

const services = vi.hoisted(() => ({
  complete: vi.fn<typeof completeScheduledAgentRun>(),
  release: vi.fn<typeof releaseScheduledAgentRun>(),
}));

vi.mock("@/db/services/scheduled-agent-jobs", () => ({
  completeScheduledAgentRun: services.complete,
  releaseScheduledAgentRun: services.release,
}));

import completionHook from "@/agent/hooks/scheduled-run-completion";

const runId = "00000000-0000-4000-8000-000000000001";
const leaseToken = "00000000-0000-4000-8000-000000000002";
const context = {
  agent: { name: "test-agent" },
  channel: { continuationToken: `scheduled-run:${runId}` },
  async getSandbox() {
    throw new Error("Sandbox access is outside this focused test.");
  },
  getSkill() {
    throw new Error("Skill access is outside this focused test.");
  },
  session: {
    auth: {
      current: null,
      initiator: {
        attributes: {
          scheduledRunId: runId,
          scheduledRunLeaseToken: leaseToken,
        },
        authenticator: "scheduled-worker",
        principalId: "user-1",
        principalType: "user",
      },
    },
    id: "worker-session",
    turn: { id: "turn-1", sequence: 0 },
  },
} satisfies HookContext;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null)));
});

describe("scheduled run completion hook", () => {
  it("persists the outcome and immediately wakes report delivery", async () => {
    services.complete.mockResolvedValue({
      attempts: 1,
      completedAt: "2026-09-01T13:02:00.000Z",
      createdAt: "2026-09-01T13:00:00.000Z",
      id: runId,
      jobId: "00000000-0000-4000-8000-000000000003",
      lastError: null,
      leaseExpiresAt: null,
      leaseToken: null,
      outcome: {
        kind: "result",
        summary: "The price fell to $250.",
        urgency: "normal",
      },
      reportStatus: "pending",
      retryAt: null,
      scheduledFor: "2026-09-01T13:00:00.000Z",
      startedAt: "2026-09-01T13:00:00.000Z",
      status: "completed",
      updatedAt: "2026-09-01T13:02:00.000Z",
      workerSessionId: "worker-session",
    });
    const handler = completionHook.events?.["result.completed"];
    await handler?.(
      {
        data: {
          result: {
            kind: "result",
            summary: "The price fell to $250.",
            urgency: "normal",
          },
          sequence: 0,
          stepIndex: 0,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-01T13:02:00.000Z", id: "event-1" },
        type: "result.completed",
      },
      context
    );

    expect(services.complete).toHaveBeenCalledWith(
      runId,
      leaseToken,
      {
        kind: "result",
        summary: "The price fell to $250.",
        urgency: "normal",
      },
      new Date("2026-09-01T13:02:00.000Z")
    );
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://example.com/internal/scheduled-run/report"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("releases a failed worker for retry", async () => {
    const handler = completionHook.events?.["turn.failed"];
    await handler?.(
      {
        data: {
          code: "model_error",
          message: "Model unavailable.",
          sequence: 0,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-01T13:02:00.000Z", id: "event-2" },
        type: "turn.failed",
      },
      context
    );

    expect(services.release).toHaveBeenCalledWith(
      runId,
      leaseToken,
      "Model unavailable.",
      new Date("2026-09-01T13:02:00.000Z")
    );
  });
});
