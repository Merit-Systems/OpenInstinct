import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HookContext } from "eve/hooks";
import type {
  completeScheduledAgentRun,
  deferScheduledAgentRunCompletion,
  markScheduledAgentRunStarted,
  releaseScheduledAgentRun,
  waitForScheduledAgentRunInput,
} from "@db/services/scheduled-agent-jobs";

const services = vi.hoisted(() => ({
  complete: vi.fn<typeof completeScheduledAgentRun>(),
  deferCompletion: vi.fn<typeof deferScheduledAgentRunCompletion>(),
  markStarted: vi.fn<typeof markScheduledAgentRunStarted>(),
  release: vi.fn<typeof releaseScheduledAgentRun>(),
  waitForInput: vi.fn<typeof waitForScheduledAgentRunInput>(),
}));

vi.mock("@db/services/scheduled-agent-jobs", () => ({
  completeScheduledAgentRun: services.complete,
  deferScheduledAgentRunCompletion: services.deferCompletion,
  markScheduledAgentRunStarted: services.markStarted,
  releaseScheduledAgentRun: services.release,
  waitForScheduledAgentRunInput: services.waitForInput,
}));

import completionHook from "@agent/hooks/scheduled-run-completion";

const runId = "00000000-0000-4000-8000-000000000001";
const leaseToken = "00000000-0000-4000-8000-000000000002";
const retryLeaseToken = "00000000-0000-4000-8000-000000000005";
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

const resumedContext = {
  ...context,
  session: {
    ...context.session,
    auth: {
      ...context.session.auth,
      current: {
        attributes: {},
        authenticator: "linq",
        principalId: "user-1",
        principalType: "user" as const,
      },
    },
  },
} satisfies HookContext;

const retriedContext = {
  ...context,
  session: {
    ...context.session,
    auth: {
      ...context.session.auth,
      current: {
        attributes: {
          scheduledRunId: runId,
          scheduledRunLeaseToken: retryLeaseToken,
        },
        authenticator: "scheduled-worker",
        principalId: "user-1",
        principalType: "user" as const,
      },
    },
  },
} satisfies HookContext;

beforeEach(() => {
  vi.clearAllMocks();
  services.markStarted.mockResolvedValue(true);
  services.deferCompletion.mockResolvedValue(true);
  services.release.mockResolvedValue("queued");
});

describe("scheduled run completion hook", () => {
  it("starts the runtime lease only when the worker turn begins", async () => {
    const handler = completionHook.events?.["turn.started"];
    await handler?.(
      {
        data: {
          sequence: 0,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-01T13:00:05.000Z", id: "event-start" },
        type: "turn.started",
      },
      context
    );

    expect(services.markStarted).toHaveBeenCalledExactlyOnceWith(
      runId,
      leaseToken,
      "worker-session",
      21_600_000,
      new Date("2026-09-01T13:00:05.000Z")
    );
  });

  it("uses a retry turn's current lease over the original session lease", async () => {
    const handler = completionHook.events?.["turn.started"];
    await handler?.(
      {
        data: { sequence: 1, turnId: "turn-2" },
        meta: { at: "2026-09-01T13:05:05.000Z", id: "event-retry" },
        type: "turn.started",
      },
      retriedContext
    );

    expect(services.markStarted).toHaveBeenCalledExactlyOnceWith(
      runId,
      retryLeaseToken,
      "worker-session",
      21_600_000,
      new Date("2026-09-01T13:05:05.000Z")
    );
  });

  it("persists the outcome for durable report delivery", async () => {
    services.complete.mockResolvedValue({
      status: "completed",
      run: {
        attempts: 1,
        completedAt: new Date("2026-09-01T13:02:00.000Z"),
        createdAt: new Date("2026-09-01T13:00:00.000Z"),
        deferredCompletionTurnId: null,
        id: runId,
        pendingInputRequests: null,
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
        reportSequence: 1,
        reportLeaseExpiresAt: null,
        reportLeaseToken: null,
        retryAt: null,
        scheduledFor: new Date("2026-09-01T13:00:00.000Z"),
        startedAt: new Date("2026-09-01T13:00:00.000Z"),
        status: "completed",
        updatedAt: new Date("2026-09-01T13:02:00.000Z"),
        workerSessionId: "worker-session",
      },
    });
    const handler = completionHook.events?.["message.completed"];
    await handler?.(
      {
        data: {
          finishReason: "stop",
          message: "The price fell to $250.",
          sequence: 0,
          stepIndex: 0,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-01T13:02:00.000Z", id: "event-1" },
        type: "message.completed",
      },
      context
    );

    expect(services.complete).toHaveBeenCalledWith(
      runId,
      leaseToken,
      "turn-1",
      {
        kind: "result",
        summary: "The price fell to $250.",
        urgency: "normal",
      },
      new Date("2026-09-01T13:02:00.000Z")
    );
  });

  it("defers an interim outcome until background work wakes a later turn", async () => {
    const delegated = completionHook.events?.["subagent.completed"];
    await delegated?.(
      {
        data: {
          backgroundTask: { status: "working", taskId: "task-1" },
          callId: "call-1",
          output: '{"status":"working"}',
          subagentName: "browser-agent",
        },
        meta: { at: "2026-09-01T13:01:00.000Z", id: "event-task" },
        type: "subagent.completed",
      },
      context
    );
    services.complete.mockResolvedValue({ status: "deferred" });

    const completed = completionHook.events?.["message.completed"];
    await completed?.(
      {
        data: {
          finishReason: "stop",
          message: null,
          sequence: 0,
          stepIndex: 1,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-01T13:01:01.000Z", id: "event-interim" },
        type: "message.completed",
      },
      context
    );

    expect(services.deferCompletion).toHaveBeenCalledExactlyOnceWith(
      runId,
      leaseToken,
      "turn-1",
      new Date("2026-09-01T13:01:00.000Z")
    );
    expect(services.complete).toHaveBeenCalledWith(
      runId,
      leaseToken,
      "turn-1",
      expect.anything(),
      new Date("2026-09-01T13:01:01.000Z")
    );
  });

  it("ignores messages emitted before a tool call completes", async () => {
    const completed = completionHook.events?.["message.completed"];
    await completed?.(
      {
        data: {
          finishReason: "tool-calls",
          message: "I will check that now.",
          sequence: 0,
          stepIndex: 0,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-01T13:01:00.000Z", id: "event-tool-text" },
        type: "message.completed",
      },
      context
    );

    expect(services.complete).not.toHaveBeenCalled();
  });

  it("retries a non-success model boundary instead of completing it", async () => {
    const completed = completionHook.events?.["message.completed"];
    await completed?.(
      {
        data: {
          finishReason: "length",
          message: "This response was truncated",
          sequence: 0,
          stepIndex: 0,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-01T13:01:00.000Z", id: "event-truncated" },
        type: "message.completed",
      },
      context
    );

    expect(services.complete).not.toHaveBeenCalled();
    expect(services.release).toHaveBeenCalledExactlyOnceWith(
      runId,
      leaseToken,
      "Scheduled worker stopped with finish reason: length.",
      new Date("2026-09-01T13:01:00.000Z")
    );
  });

  it("bounds a long final handoff before persisting it", async () => {
    const completed = completionHook.events?.["message.completed"];
    await completed?.(
      {
        data: {
          finishReason: "stop",
          message: "a".repeat(4_001),
          sequence: 0,
          stepIndex: 0,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-01T13:01:00.000Z", id: "event-long" },
        type: "message.completed",
      },
      context
    );

    expect(services.complete).toHaveBeenCalledWith(
      runId,
      leaseToken,
      "turn-1",
      {
        kind: "result",
        summary: "a".repeat(4_000),
        urgency: "normal",
      },
      new Date("2026-09-01T13:01:00.000Z")
    );
  });

  it("parks the worker and queues its question for delivery", async () => {
    const request = {
      action: {
        callId: "call-1",
        input: { prompt: "Which airport?" },
        kind: "tool-call" as const,
        toolName: "ask_question",
      },
      allowFreeform: true,
      kind: "question" as const,
      prompt: "Which airport?",
      requestId: "request-1",
    };
    services.waitForInput.mockResolvedValue({
      attempts: 1,
      completedAt: null,
      createdAt: new Date("2026-09-01T13:00:00.000Z"),
      id: runId,
      deferredCompletionTurnId: null,
      pendingInputRequests: [request],
      jobId: "00000000-0000-4000-8000-000000000003",
      lastError: null,
      leaseExpiresAt: null,
      leaseToken,
      outcome: null,
      reportStatus: "pending",
      reportSequence: 1,
      reportLeaseExpiresAt: null,
      reportLeaseToken: null,
      retryAt: null,
      scheduledFor: new Date("2026-09-01T13:00:00.000Z"),
      startedAt: new Date("2026-09-01T13:00:00.000Z"),
      status: "waiting_for_input",
      updatedAt: new Date("2026-09-01T13:01:00.000Z"),
      workerSessionId: "worker-session",
    });
    const handler = completionHook.events?.["input.requested"];
    await handler?.(
      {
        data: {
          requests: [request],
          sequence: 0,
          stepIndex: 0,
          turnId: "turn-1",
        },
        meta: { at: "2026-09-01T13:01:00.000Z", id: "event-input" },
        type: "input.requested",
      },
      context
    );

    expect(services.waitForInput).toHaveBeenCalledWith(
      runId,
      leaseToken,
      [request],
      new Date("2026-09-01T13:01:00.000Z")
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

  it("retains the scheduled identity after the user resumes the turn", async () => {
    const handler = completionHook.events?.["turn.failed"];
    await handler?.(
      {
        data: {
          code: "model_error",
          message: "Model unavailable after resumption.",
          sequence: 1,
          turnId: "turn-2",
        },
        meta: { at: "2026-09-01T13:03:00.000Z", id: "event-3" },
        type: "turn.failed",
      },
      resumedContext
    );

    expect(services.release).toHaveBeenCalledWith(
      runId,
      leaseToken,
      "Model unavailable after resumption.",
      new Date("2026-09-01T13:03:00.000Z")
    );
  });
});
