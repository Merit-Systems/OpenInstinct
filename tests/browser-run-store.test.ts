import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserRunGroup,
  readBrowserRunGroups,
  saveBrowserRunGroup,
  updateBrowserRunTask,
} from "../lib/browser-run-store";

describe("browser run store", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn<(event: Event) => boolean>(() => true),
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("persists groups and their task rows", () => {
    const group = createBrowserRunGroup({
      concurrency: 4,
      name: "Regression run",
      prompts: ["Open example.com", "Open iana.org"],
    });

    saveBrowserRunGroup(group);

    expect(readBrowserRunGroups()).toEqual([group]);
  });

  it("updates one recoverable task without replacing its group", () => {
    const group = createBrowserRunGroup({
      concurrency: 2,
      name: "Recovery run",
      prompts: ["Open example.com"],
    });
    const task = group.tasks[0];
    expect(task).toBeDefined();
    saveBrowserRunGroup(group);

    updateBrowserRunTask(group.id, task?.id ?? "", {
      costComplete: true,
      costUsd: 0.01,
      sessionId: "session_123",
      status: "running",
    });

    expect(readBrowserRunGroups()[0]?.tasks[0]).toMatchObject({
      costComplete: true,
      costUsd: 0.01,
      sessionId: "session_123",
      status: "running",
    });
  });
});
