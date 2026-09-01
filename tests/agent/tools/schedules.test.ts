import type { ToolContext, ToolDefinition } from "eve/tools";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  createScheduledAgentJob,
  listScheduledAgentJobs,
  updateScheduledAgentJob,
} from "@/db/services/scheduled-agent-jobs";

const services = vi.hoisted(() => ({
  create: vi.fn<typeof createScheduledAgentJob>(),
  list: vi.fn<typeof listScheduledAgentJobs>(),
  update: vi.fn<typeof updateScheduledAgentJob>(),
}));

vi.mock("@/db/services/scheduled-agent-jobs", () => ({
  createScheduledAgentJob: services.create,
  listScheduledAgentJobs: services.list,
  updateScheduledAgentJob: services.update,
}));

import createSchedule from "@/agent/tools/schedules/create";
import listSchedules from "@/agent/tools/schedules/list";
import updateSchedule from "@/agent/tools/schedules/update";
import reactToMessage from "@/agent/tools/react_to_message";
import sendMessage from "@/agent/tools/send_message";

describe("schedule tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a schedule without a multiplexed action field", async () => {
    const job = scheduledJob();
    services.create.mockResolvedValue(job);

    const result = await createSchedule.execute(
      {
        missedRunPolicy: "run_latest",
        prompt: "Send the morning summary.",
        timing: {
          frequency: "daily",
          kind: "calendar",
          localTime: "09:00",
          timezone: "America/New_York",
        },
      },
      toolContext("schedules-create")
    );

    expect(inputProperties(createSchedule.inputSchema)).toEqual([
      "missedRunPolicy",
      "prompt",
      "timing",
    ]);
    expect(services.create).toHaveBeenCalledExactlyOnceWith(
      { userId: "user-1", workspaceId: "workspace-1" },
      {
        linqThreadId: "linq:dm:chat-1",
        missedRunPolicy: "run_latest",
        prompt: "Send the morning summary.",
        timing: {
          frequency: "daily",
          kind: "calendar",
          localTime: "09:00",
          timezone: "America/New_York",
        },
      }
    );
    expect(result).toEqual(scheduleSummary(job));
  });

  it("lists schedules through a dedicated empty-input tool", async () => {
    const job = scheduledJob();
    services.list.mockResolvedValue([job]);

    const result = await listSchedules.execute(
      {},
      toolContext("schedules-list")
    );

    expect(inputProperties(listSchedules.inputSchema)).toEqual([]);
    expect(services.list).toHaveBeenCalledExactlyOnceWith({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    expect(result).toEqual([scheduleSummary(job)]);
  });

  it("updates a schedule without carrying an action discriminator", async () => {
    const job = scheduledJob();
    services.update.mockResolvedValue(job);

    const result = await updateSchedule.execute(
      {
        id: job.id,
        status: "paused",
      },
      toolContext("schedules-update")
    );

    expect(inputProperties(updateSchedule.inputSchema)).toEqual([
      "id",
      "prompt",
      "status",
      "timing",
    ]);
    expect(services.update).toHaveBeenCalledExactlyOnceWith(
      { userId: "user-1", workspaceId: "workspace-1" },
      job.id,
      { status: "paused" }
    );
    expect(result).toEqual(scheduleSummary(job));
  });

  it("prevents an isolated scheduled worker from messaging or reacting", () => {
    expect(() =>
      sendMessage.execute(
        { kind: "message", markdown: "This should not be delivered." },
        toolContext("send_message", "scheduled-worker")
      )
    ).toThrow("Scheduled workers return a structured outcome");
    expect(() =>
      reactToMessage.execute(
        { operation: "add", type: "heart" },
        toolContext("react_to_message", "scheduled-worker")
      )
    ).toThrow("Scheduled workers return a structured outcome");
  });
});

function toolContext(toolName: string, authenticator = "test") {
  return {
    abortSignal: new AbortController().signal,
    callId: "call-schedule",
    async getSandbox() {
      throw new Error("Sandbox access is not expected.");
    },
    getSkill() {
      throw new Error("Skill access is not expected.");
    },
    async getToken() {
      throw new Error("Token access is not expected.");
    },
    requireAuth() {
      throw new Error("Connection authorization is not expected.");
    },
    session: {
      auth: {
        current: {
          attributes: {
            linqThreadId: "linq:dm:chat-1",
            workspaceId: "workspace-1",
          },
          authenticator,
          principalId: "user-1",
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
    toolName,
  } satisfies ToolContext;
}

function inputProperties(schema: ToolDefinition["inputSchema"]) {
  if (!(schema instanceof z.ZodType)) {
    throw new TypeError("Expected an authored Zod input schema.");
  }
  return Object.keys(z.toJSONSchema(schema).properties ?? {});
}

function scheduledJob(): Awaited<
  ReturnType<typeof listScheduledAgentJobs>
>[number] {
  return {
    createdAt: "2026-09-01T12:00:00.000Z",
    createdByUserId: "user-1",
    id: "00000000-0000-4000-8000-000000000001",
    lastError: null,
    lastRunAt: null,
    linqThreadId: "linq:dm:chat-1",
    missedRunPolicy: "run_latest",
    nextRunAt: "2026-09-02T13:00:00.000Z",
    prompt: "Send the morning summary.",
    revision: 0,
    status: "active",
    timing: {
      frequency: "daily",
      kind: "calendar",
      localTime: "09:00",
      timezone: "America/New_York",
    },
    updatedAt: "2026-09-01T12:00:00.000Z",
    workspaceId: "workspace-1",
  };
}

function scheduleSummary(job: ReturnType<typeof scheduledJob>) {
  return {
    createdAt: job.createdAt,
    id: job.id,
    lastError: job.lastError,
    lastRunAt: job.lastRunAt,
    nextRunAt: job.nextRunAt,
    prompt: job.prompt,
    status: job.status,
    timing: job.timing,
  };
}
