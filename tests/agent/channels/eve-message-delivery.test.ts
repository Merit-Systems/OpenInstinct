import type { EveChannelInput } from "eve/channels/eve";
import type { DynamicResolveContext, ToolContext } from "eve/tools";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messaging from "@agent/tools/messaging";
import type {
  finalizeScheduledReport,
  releaseScheduledReport,
} from "@db/services/scheduled-agent-jobs";

const channelCapture = vi.hoisted(() => {
  const configs: EveChannelInput[] = [];
  return { configs };
});
const delivery = vi.hoisted(() => ({
  finalize: vi.fn<typeof finalizeScheduledReport>(),
  release: vi.fn<typeof releaseScheduledReport>(),
}));

vi.mock(import("eve/channels/eve"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    eveChannel(config: EveChannelInput) {
      channelCapture.configs.push(config);
      return original.eveChannel(config);
    },
  };
});
vi.mock("@db/services/scheduled-agent-jobs", () => ({
  finalizeScheduledReport: delivery.finalize,
  releaseScheduledReport: delivery.release,
}));

// Loads the production channel so the mocked factory captures its event configuration.
await import("@agent/channels/eve");

const events = channelCapture.configs[0]?.events;
const handleMessageCompleted = events?.["message.completed"];
if (!handleMessageCompleted) {
  throw new Error("The Eve channel must configure scheduled report delivery.");
}

type ActionParameters = Parameters<typeof handleMessageCompleted>;

describe("Eve scheduled report delivery", () => {
  it("awaits browser report finalization without calling the provider", async () => {
    const finalized = Promise.withResolvers<boolean>();
    delivery.finalize.mockImplementation(() => finalized.promise);
    const session = scheduledReportSession();
    const resolve = messaging.events["turn.started"];
    if (!resolve) throw new Error("Expected messaging resolver");
    const tools = await resolve(
      { type: "turn.started", data: { turnId: "turn-1", sequence: 0 } },
      {
        channel: { kind: "channel:eve", metadata: {} },
        model: null,
        messages: [],
        session: session.session,
      } satisfies DynamicResolveContext
    );
    if (!tools || !("send_message" in tools))
      throw new Error("Expected reporting tool");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const completed = vi.fn<() => void>();
    try {
      const pending = Promise.resolve(
        tools.send_message.execute(
          { kind: "message", text: "The price fell." },
          {
            ...session,
            callId: "report-call",
            toolName: "send_message",
            abortSignal: new AbortController().signal,
            async getToken() {
              throw new Error("Unexpected provider authorization");
            },
            requireAuth() {
              throw new Error("Unexpected provider authorization");
            },
          } satisfies ToolContext
        )
      ).then(completed);
      await vi.waitFor(() => {
        expect(delivery.finalize).toHaveBeenCalledExactlyOnceWith(
          "00000000-0000-4000-8000-000000000002",
          "00000000-0000-4000-8000-000000000004",
          "delivered"
        );
      });
      expect(completed).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      finalized.resolve(true);
      await pending;
      expect(completed).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    delivery.finalize.mockResolvedValue(true);
    delivery.release.mockResolvedValue(true);
  });

  it("does not register a second tool-result finalizer", () => {
    expect(events["action.result"]).toBeUndefined();
  });

  it("suppresses a report when the turn finishes without send_message", async () => {
    await handleMessageCompleted(
      {
        finishReason: "stop",
        message: "Internal final text",
        sequence: 0,
        stepIndex: 0,
        turnId: "turn-1",
      },
      {},
      scheduledReportSession()
    );

    expect(delivery.finalize).toHaveBeenCalledExactlyOnceWith(
      "00000000-0000-4000-8000-000000000002",
      "00000000-0000-4000-8000-000000000004",
      "suppressed"
    );
  });
});

function scheduledReportSession() {
  return {
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    session: {
      auth: {
        current: {
          attributes: {
            conversationChannel: "eve",
            conversationId: "session-1",
            workspaceId: "workspace-1",
            scheduleId: "00000000-0000-4000-8000-000000000001",
            scheduledReportLeaseToken: "00000000-0000-4000-8000-000000000004",
            scheduledReportSequence: "1",
            scheduledRunId: "00000000-0000-4000-8000-000000000002",
          },
          authenticator: "scheduled-result",
          principalId: "user-1",
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
  } satisfies ActionParameters[2];
}
