/* oxlint-disable typescript/no-unsafe-type-assertion -- Eve tool contexts are runtime-owned; these fixtures exercise only mocked authorization and abort-signal boundaries. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import * as WorkerAccess from "@/agent/subagents/worker/lib/access";
import * as OwnedBrowser from "@/agent/subagents/worker/lib/owned-browser";
import { kernel } from "@/lib/kernel";
import { toolContextFor } from "./helpers/tool-context";
import computerAction from "../agent/subagents/worker/tools/computer_action";
import executePlaywrightCode from "../agent/subagents/worker/tools/execute_playwright_code";

const mocks = {
  batch: vi.spyOn(kernel.browsers.computer, "batch"),
  playwrightExecute: vi.spyOn(kernel.browsers.playwright, "execute"),
  readClipboard: vi.spyOn(kernel.browsers.computer, "readClipboard"),
  requireOwnedBrowserSession: vi.spyOn(
    OwnedBrowser,
    "requireOwnedBrowserSession"
  ),
  requireWorkerScope: vi.spyOn(WorkerAccess, "requireWorkerScope"),
  writeClipboard: vi.spyOn(kernel.browsers.computer, "writeClipboard"),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkerScope.mockResolvedValue({
    userId: "user-1",
    workspaceId: "workspace-1",
  });
  mocks.requireOwnedBrowserSession.mockResolvedValue({
    createdAt: "2026-08-31T00:00:00.000Z",
    sessionId: "browser-1",
    workerSessionId: "worker-session-1",
  });
  mocks.batch.mockResolvedValue();
  mocks.playwrightExecute.mockResolvedValue({ success: true });
  mocks.readClipboard.mockResolvedValue({ text: "clipboard value" });
  mocks.writeClipboard.mockResolvedValue();
});

describe("worker browser tools", () => {
  it("sends contiguous computer actions through Kernel batch while preserving read order", async () => {
    const execute = computerAction.execute;
    const context = toolContextFor();
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
      context
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
      { signal: context.abortSignal }
    );
    expect(mocks.batch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readClipboard.mock.invocationCallOrder[0] ?? Infinity
    );
    expect(mocks.readClipboard.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.batch.mock.invocationCallOrder[1] ?? Infinity
    );
    expect(result).toMatchObject({ data: [{ text: "clipboard value" }] });
  });

  it("uses one fixed Playwright ceiling without asking the model to tune it", async () => {
    const execute = executePlaywrightCode.execute;
    const context = toolContextFor();
    await execute(
      { code: "return await page.title();", session_id: "browser-1" },
      context
    );

    expect(mocks.playwrightExecute).toHaveBeenCalledExactlyOnceWith(
      "browser-1",
      { code: "return await page.title();", timeout_sec: 25 },
      { signal: context.abortSignal }
    );

    const inputSchema = executePlaywrightCode.inputSchema;
    if (!(inputSchema instanceof z.ZodObject)) {
      throw new Error("execute_playwright_code must use a Zod input schema.");
    }
    expect(Object.keys(inputSchema.shape).toSorted()).toEqual([
      "code",
      "session_id",
    ]);
  });

  it("keeps oversized Playwright results out of the next model prompt", () => {
    const project = executePlaywrightCode.toModelOutput;
    if (!project) {
      throw new Error("execute_playwright_code must project model output.");
    }

    const output = project({
      result: "x".repeat(13_000),
      stderr: "y".repeat(3_000),
      success: true,
    });

    expect(output).toMatchObject({
      type: "json",
      value: {
        result: {
          characterCount: 13_002,
          truncated: true,
        },
        success: true,
      },
    });
    expect(JSON.stringify(output)).not.toContain("y".repeat(3_000));
  });
});
