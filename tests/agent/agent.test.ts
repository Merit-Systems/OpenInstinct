import type { DynamicResolveContext } from "eve";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { isScheduledAgentRunLeaseActive } from "@db/services/scheduled-agent-run-leases";
import type { getSelectedModel } from "@db/services/settings";
import { directGeminiModelId } from "@shared/model/selection";

const services = vi.hoisted(() => ({
  getModel: vi.fn<typeof getSelectedModel>(),
  isActive: vi.fn<typeof isScheduledAgentRunLeaseActive>(),
}));
interface GoogleEnv {
  GOOGLE_GENERATIVE_AI_API_KEY: string | undefined;
}
const googleEnv = vi.hoisted<GoogleEnv>(() => ({
  GOOGLE_GENERATIVE_AI_API_KEY: "test-google-key",
}));

vi.mock("@db/services/scheduled-agent-run-leases", () => ({
  isScheduledAgentRunLeaseActive: services.isActive,
}));
vi.mock("@db/services/settings", () => ({
  getSelectedModel: services.getModel,
}));
vi.mock("@shared/environment", () => ({ env: googleEnv }));

import agent from "@agent/agent";

const runId = "00000000-0000-4000-8000-000000000001";
const oldLeaseToken = "00000000-0000-4000-8000-000000000002";
const retryLeaseToken = "00000000-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.clearAllMocks();
  googleEnv.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
  services.getModel.mockResolvedValue("openai/gpt-5.6-sol-fast");
});

describe("root agent model resolution", () => {
  it("accepts a valid retry lease forwarded into an older Eve session", async () => {
    services.isActive.mockImplementation(async (_runId, leaseToken) => {
      return leaseToken === retryLeaseToken;
    });

    const model = await agent.model.events["step.started"]?.(
      {},
      scheduledWorkerContext()
    );

    expect(services.isActive).toHaveBeenCalledExactlyOnceWith(
      runId,
      retryLeaseToken
    );
    expect(services.getModel).toHaveBeenCalledExactlyOnceWith({
      userId: "user-1",
      workspaceId: "workspace-1",
    });
    expect(model).toBe("openai/gpt-5.6-sol-fast");
  });

  it("rejects a scheduled worker after its lease is replaced", async () => {
    services.isActive.mockResolvedValue(false);

    await expect(
      agent.model.events["step.started"]?.({}, scheduledWorkerContext())
    ).rejects.toThrow("The scheduled run lease is no longer active.");
    expect(services.getModel).not.toHaveBeenCalled();
  });

  it("uses a direct Gemini model only when the workspace selects it", async () => {
    services.isActive.mockResolvedValue(true);
    services.getModel.mockResolvedValue(directGeminiModelId);

    const selected = await agent.model.events["step.started"]?.(
      {},
      scheduledWorkerContext()
    );

    expect(selected).toMatchObject({
      model: { modelId: "gemini-3.5-flash-lite" },
      modelContextWindowTokens: 1_048_576,
    });
  });

  it("fails closed when a selected direct model has no API key", async () => {
    services.isActive.mockResolvedValue(true);
    services.getModel.mockResolvedValue(directGeminiModelId);
    googleEnv.GOOGLE_GENERATIVE_AI_API_KEY = undefined;

    await expect(
      agent.model.events["step.started"]?.({}, scheduledWorkerContext())
    ).rejects.toThrow("GOOGLE_GENERATIVE_AI_API_KEY is required");
  });
});

function scheduledWorkerContext(): DynamicResolveContext {
  return {
    model: null,
    channel: { kind: "http" },
    messages: [],
    session: {
      auth: {
        current: {
          attributes: {
            scheduledRunId: runId,
            scheduledRunLeaseToken: retryLeaseToken,
            workspaceId: "workspace-1",
          },
          authenticator: "scheduled-worker",
          principalId: "user-1",
          principalType: "user",
        },
        initiator: {
          attributes: {
            scheduledRunId: runId,
            scheduledRunLeaseToken: oldLeaseToken,
            workspaceId: "workspace-1",
          },
          authenticator: "scheduled-worker",
          principalId: "user-1",
          principalType: "user",
        },
      },
      id: "worker-session",
    },
  };
}
