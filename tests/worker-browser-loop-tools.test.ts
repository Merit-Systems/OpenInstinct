/* oxlint-disable typescript/no-unsafe-type-assertion -- Eve tool contexts are runtime-owned; these fixtures exercise mocked ownership, durable ref state, and Browser Loop boundaries. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BrowserLoopModule from "@onkernel/browser-loop";
import type {
  BatchReadResult,
  BrowserActResult,
  BrowserRefState,
} from "@onkernel/browser-loop";

const initialRefState: BrowserRefState = {
  activeTargetId: "target-1",
  documents: [["target-1", "loader-1"]],
  generations: [["target-1", 0]],
  refCounter: 1,
  refs: [],
};
const nextRefState: BrowserRefState = {
  ...initialRefState,
  refCounter: 2,
};

const mocks = vi.hoisted(() => ({
  close: vi.fn<() => void>(),
  execute:
    vi.fn<
      (
        _action: unknown,
        _signal: AbortSignal | undefined
      ) => Promise<BatchReadResult[]>
    >(),
  exportRefState: vi.fn<() => BrowserRefState>(),
  importRefState: vi.fn<(_state: BrowserRefState) => void>(),
  mask: vi.fn<
    (
      _sessionId: string,
      _signal: AbortSignal | undefined,
      _operation: () => Promise<BatchReadResult[]>
    ) => Promise<BatchReadResult[]>
  >(),
  requireOwnedBrowserSession:
    vi.fn<(_scope: unknown, _sessionId: string) => Promise<unknown>>(),
  requireWorkerScope: vi.fn<(_context: unknown) => Promise<unknown>>(),
  retrieveBrowser: vi.fn<
    (
      _sessionId: string,
      _parameters: unknown,
      _options: unknown
    ) => Promise<{
      cdp_ws_url: string;
    }>
  >(),
  storedRefState: undefined as BrowserRefState | undefined,
  withBrowserRefState:
    vi.fn<
      (
        _scope: unknown,
        _sessionId: string,
        _operation: (
          state: BrowserRefState | undefined
        ) => Promise<{ refState: BrowserRefState; result: unknown }>
      ) => Promise<unknown>
    >(),
}));

vi.mock("@onkernel/browser-loop", async (importOriginal) => {
  const actual = await importOriginal<typeof BrowserLoopModule>();
  return {
    ...actual,
    BrowserExecutor: class {
      constructor(readonly cdpUrl: string) {}

      close() {
        mocks.close();
      }

      execute(action: unknown, signal: AbortSignal | undefined) {
        return mocks.execute(action, signal);
      }

      exportRefState() {
        return mocks.exportRefState();
      }

      importRefState(state: BrowserRefState) {
        mocks.importRefState(state);
      }
    },
  };
});

vi.mock("@/agent/subagents/worker/lib/access", () => ({
  requireWorkerScope: mocks.requireWorkerScope,
}));

vi.mock("@/agent/subagents/worker/lib/owned-browser", () => ({
  requireOwnedBrowserSession: mocks.requireOwnedBrowserSession,
}));

vi.mock("@/agent/subagents/worker/lib/vault-screenshot-mask", () => ({
  withVaultBrowserObservationMask: mocks.mask,
}));

vi.mock("@/db/services/browsers", () => ({
  withBrowserRefState: mocks.withBrowserRefState,
}));

vi.mock("@/lib/kernel", () => ({
  kernel: { browsers: { retrieve: mocks.retrieveBrowser } },
}));

import {
  browserActAvailableForModel,
  browserActTool as browserAct,
} from "../agent/subagents/worker/tools/browser_act";
import browserSnapshot from "../agent/subagents/worker/tools/browser_snapshot";

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  mocks.storedRefState = initialRefState;
  mocks.requireWorkerScope.mockResolvedValue({
    userId: "user-1",
    workspaceId: "workspace-1",
  });
  mocks.requireOwnedBrowserSession.mockResolvedValue({
    sessionId: "browser-1",
  });
  mocks.retrieveBrowser.mockResolvedValue({
    cdp_ws_url: "wss://kernel.test/browser-1",
  });
  mocks.exportRefState.mockReturnValue(nextRefState);
  mocks.mask.mockImplementation(
    async (
      _sessionId: string,
      _signal: AbortSignal | undefined,
      operation: () => Promise<BatchReadResult[]>
    ) => operation()
  );
  mocks.withBrowserRefState.mockImplementation(
    async (
      _scope: unknown,
      _sessionId: string,
      operation: (
        state: BrowserRefState | undefined
      ) => Promise<{ refState: BrowserRefState; result: unknown }>
    ) => {
      const outcome = await operation(mocks.storedRefState);
      mocks.storedRefState = outcome.refState;
      return outcome.result;
    }
  );
});

describe("Browser Loop worker tools", () => {
  it("derives the snapshot contract from Browser Loop and persists refs", async () => {
    const schema = browserSnapshot.inputSchema as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(schema.properties).toHaveProperty("filter");
    expect(schema.properties).toHaveProperty("session_id");
    expect(schema.required).toContain("session_id");

    mocks.execute.mockResolvedValue([
      {
        label: "snapshot",
        text: 'button "Continue" [e1]',
        type: "browser_text",
      },
    ]);

    await expect(
      browserSnapshot.execute(
        { filter: "interactive", session_id: "browser-1" },
        {} as never
      )
    ).resolves.toEqual({ message: 'button "Continue" [e1]' });

    expect(mocks.importRefState).toHaveBeenCalledExactlyOnceWith(
      initialRefState
    );
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
      { filter: "interactive", type: "browser_snapshot" },
      undefined
    );
    expect(mocks.storedRefState).toEqual(nextRefState);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("runs a bounded ref plan and returns Browser Loop's successor evidence", async () => {
    const result = workedResult();
    mocks.execute.mockResolvedValue([{ result, type: "browser_act" }]);

    const output = await browserAct.execute(
      {
        session_id: "browser-1",
        steps: [
          {
            expect: { text: "Ready", type: "text" },
            ref: "e1",
            type: "click",
          },
        ],
      },
      {} as never
    );

    expect(output).toMatchObject({ outcome: "worked" });
    expect(JSON.stringify(output)).toContain("browser_act: worked");
    expect(JSON.stringify(output)).toContain("successor: Ready");
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(
      {
        steps: [
          {
            expect: { text: "Ready", type: "text" },
            ref: "e1",
            type: "click",
          },
        ],
        type: "browser_act",
      },
      undefined
    );
  });

  it("fails fast on a stale ref while committing the pruned ref state", async () => {
    const result: BrowserActResult = {
      outcome: "didnt",
      steps: [
        {
          diagnostics: ['ref "e1" is stale; call browser_snapshot again'],
          index: 0,
          outcome: "didnt",
          type: "click",
        },
      ],
      stopped_at: 0,
      stop_reason: "stale_ref",
      successor: { error: 'ref "e1" is stale', status: "unavailable" },
    };
    mocks.execute.mockResolvedValue([{ result, type: "browser_act" }]);

    await expect(
      browserAct.execute(
        {
          session_id: "browser-1",
          steps: [{ ref: "e1", type: "click" }],
        },
        {} as never
      )
    ).rejects.toThrow(/stale_ref/);

    expect(mocks.storedRefState).toEqual(nextRefState);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("replaces incompatible persisted ref state before the next retry", async () => {
    mocks.importRefState.mockImplementationOnce(() => {
      throw new Error("unsupported browser ref state version 99");
    });

    await expect(
      browserSnapshot.execute(
        { filter: "interactive", session_id: "browser-1" },
        {} as never
      )
    ).rejects.toThrow("unsupported browser ref state version 99");

    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.storedRefState).toEqual(nextRefState);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["moonshotai/kimi-k2.5", false],
    ["moonshotai/kimi-k3", false],
    ["openrouter/moonshotai/kimi-k3", false],
    ["openai/gpt-5.6-sol-fast", true],
  ])("gates browser_act for %s", (modelId, expected) => {
    expect(browserActAvailableForModel(modelId)).toBe(expected);
  });

  it.each([
    [
      "snapshot",
      browserSnapshot,
      [{ filter: "interactive", session_id: "browser-1" }],
    ],
    [
      "action",
      browserAct,
      [{ session_id: "browser-1", steps: [{ ref: "e1", type: "click" }] }],
    ],
  ] as const)(
    "redacts the CDP credential from %s failures",
    async (_name, tool, arguments_) => {
      mocks.retrieveBrowser.mockResolvedValue({
        cdp_ws_url: "wss://kernel.test/connect?token=SENSITIVE_SESSION_TOKEN",
      });
      mocks.execute.mockRejectedValue(
        new Error(
          "CDP connection to wss://kernel.test/connect?token=SENSITIVE_SESSION_TOKEN failed"
        )
      );

      let failure: unknown;
      try {
        await tool.execute(arguments_[0], {} as never);
      } catch (error) {
        failure = error;
      }

      expect(String(failure)).toContain("redacted browser session URL");
      expect(String(failure)).not.toContain("SENSITIVE_SESSION_TOKEN");
    }
  );

  it("settles a stalled snapshot immediately after cancellation", async () => {
    const controller = new AbortController();
    mocks.execute.mockReturnValue(
      new Promise<BatchReadResult[]>(() => undefined)
    );

    const execution = browserSnapshot.execute(
      { filter: "interactive", session_id: "browser-1" },
      { abortSignal: controller.signal } as never
    );
    await vi.waitFor(() => {
      expect(mocks.execute).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(execution).rejects.toThrow("Browser snapshot cancelled");
    expect(mocks.storedRefState).toEqual(nextRefState);
    expect(mocks.close).toHaveBeenCalled();
  });

  it("redacts a CDP credential embedded in a resolved action result", async () => {
    const result: BrowserActResult = {
      outcome: "unknown",
      steps: [],
      stop_reason: "control_flow",
      successor: {
        error:
          "CDP connection to wss://kernel.test/connect?token=SENSITIVE_RESOLVED_TOKEN failed",
        status: "unavailable",
      },
    };
    mocks.execute.mockResolvedValue([{ result, type: "browser_act" }]);

    let failure: unknown;
    try {
      await browserAct.execute(
        {
          session_id: "browser-1",
          steps: [{ ref: "e1", type: "click" }],
        },
        {} as never
      );
    } catch (error) {
      failure = error;
    }

    expect(String(failure)).toContain("redacted browser session URL");
    expect(String(failure)).not.toContain("SENSITIVE_RESOLVED_TOKEN");
  });

  it.each([
    [
      "snapshot",
      browserSnapshot,
      { filter: "interactive", session_id: "browser-1" },
      15_000,
      "Browser snapshot timed out after 15000ms",
    ],
    [
      "action",
      browserAct,
      {
        session_id: "browser-1",
        steps: [{ ref: "e1", type: "click" }],
      },
      35_000,
      "Browser action timed out after 35000ms",
    ],
  ] as const)(
    "closes a stalled %s call at its application deadline",
    async (_name, tool, input, timeoutMs, message) => {
      vi.useFakeTimers();
      mocks.execute.mockReturnValue(
        new Promise<BatchReadResult[]>(() => undefined)
      );

      const execution = tool.execute(input, {} as never);
      for (let index = 0; index < 10; index += 1) await Promise.resolve();
      expect(mocks.execute).toHaveBeenCalledOnce();

      const settled = Promise.resolve(execution).then(
        () => ({ error: undefined }),
        (error: unknown) => ({ error })
      );
      await vi.advanceTimersByTimeAsync(timeoutMs);

      expect(String((await settled).error)).toContain(message);
      expect(mocks.storedRefState).toEqual(nextRefState);
      expect(mocks.close).toHaveBeenCalled();
    }
  );
});

function workedResult(): BrowserActResult {
  return {
    outcome: "worked",
    steps: [
      {
        diagnostics: ["input acknowledged"],
        expectation: {
          after: "matched",
          before: "not_matched",
          diagnostics: ["text Ready matched"],
          status: "newly_verified",
        },
        index: 0,
        outcome: "worked",
        type: "click",
      },
    ],
    successor: {
      diff: {
        added: [{ count: 1, line: 'status "Ready"' }],
        changed: true,
        removed: [],
      },
      status: "observed",
      text: 'status "Ready"',
      title: "Ready",
      url: "https://example.com/ready",
    },
  };
}
