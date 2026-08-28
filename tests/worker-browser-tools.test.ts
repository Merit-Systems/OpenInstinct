/* oxlint-disable typescript/no-unsafe-type-assertion -- Eve tool contexts are runtime-owned; these fixtures exercise only mocked authorization and abort-signal boundaries. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batch:
    vi.fn<(_id: string, _body: unknown, _options: unknown) => Promise<void>>(),
  readClipboard:
    vi.fn<(_id: string, _options: unknown) => Promise<{ text: string }>>(),
  requireOwnedBrowserSession:
    vi.fn<(_scope: unknown, _sessionId: string) => Promise<unknown>>(),
  requireWorkerScope: vi.fn<(_context: unknown) => Promise<unknown>>(),
  writeClipboard:
    vi.fn<(_id: string, _body: unknown, _options: unknown) => Promise<void>>(),
}));

vi.mock("@/agent/subagents/worker/lib/access", () => ({
  requireWorkerScope: mocks.requireWorkerScope,
}));

vi.mock("@/agent/subagents/worker/lib/owned-browser", () => ({
  requireOwnedBrowserSession: mocks.requireOwnedBrowserSession,
}));

vi.mock("@/lib/kernel", () => ({
  kernel: {
    browsers: {
      computer: {
        batch: mocks.batch,
        readClipboard: mocks.readClipboard,
        writeClipboard: mocks.writeClipboard,
      },
    },
  },
}));

import computerAction from "../agent/subagents/worker/tools/computer_action";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkerScope.mockResolvedValue({
    userId: "user-1",
    workspaceId: "workspace-1",
  });
  mocks.requireOwnedBrowserSession.mockResolvedValue({
    sessionId: "browser-1",
  });
  mocks.batch.mockResolvedValue();
  mocks.readClipboard.mockResolvedValue({ text: "clipboard value" });
  mocks.writeClipboard.mockResolvedValue();
});

describe("worker browser tools", () => {
  it("sends contiguous computer actions through Kernel batch while preserving read order", async () => {
    const execute = computerAction.execute;
    const result = await execute(
      {
        actions: [
          { click_mouse: { x: 10, y: 20 }, type: "click_mouse" },
          { type: "type_text", type_text: { text: "hello" } },
          { sleep: { duration_ms: 100 }, type: "sleep" },
          { type: "read_clipboard" },
          { scroll: { x: 10, y: 20, delta_y: 4 }, type: "scroll" },
        ],
        session_id: "browser-1",
      },
      {} as never
    );

    expect(mocks.batch).toHaveBeenCalledTimes(2);
    expect(mocks.batch).toHaveBeenNthCalledWith(
      1,
      "browser-1",
      {
        actions: [
          { click_mouse: { x: 10, y: 20 }, type: "click_mouse" },
          { type: "type_text", type_text: { text: "hello" } },
          { sleep: { duration_ms: 100 }, type: "sleep" },
        ],
      },
      { signal: undefined }
    );
    expect(mocks.batch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readClipboard.mock.invocationCallOrder[0] ?? Infinity
    );
    expect(mocks.readClipboard.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.batch.mock.invocationCallOrder[1] ?? Infinity
    );
    expect(result).toMatchObject({ data: [{ text: "clipboard value" }] });
  });
});
