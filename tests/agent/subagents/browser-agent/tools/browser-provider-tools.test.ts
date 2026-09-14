import type * as Environment from "@shared/environment";
import { describe, expect, it, vi } from "vitest";
import semanticBrowser from "@agent/subagents/browser-agent/tools/semantic_browser";
import computerAction from "@agent/subagents/browser-agent/tools/computer_action";
import captureImage from "@agent/subagents/browser-agent/tools/capture_browser_image";

const settings = vi.hoisted(() => ({ provider: "notte" }));

vi.mock("@shared/environment", async (importOriginal) => {
  const original = await importOriginal<typeof Environment>();
  return {
    ...original,
    env: {
      ...original.env,
      get BROWSER_PROVIDER() {
        return settings.provider;
      },
    },
  };
});
const context = {
  session: { id: "test", auth: { current: null, initiator: null } },
  channel: {},
  messages: [],
};

describe("provider tool selection", () => {
  it("exposes semantic CDP tools and omits Kernel-only tools with Notte", async () => {
    const tools = await semanticBrowser.events["session.started"]?.(
      {},
      context
    );
    expect(Object.keys(tools ?? {})).toEqual([
      "browser_snapshot",
      "browser_text",
      "browser_find",
      "browser_wait_for",
      "browser_act",
    ]);
    expect(
      await computerAction.events["session.started"]?.({}, context)
    ).toBeNull();
    expect(
      await captureImage.events["session.started"]?.({}, context)
    ).toBeNull();
  });

  it("keeps the full Kernel tool surface by default", async () => {
    settings.provider = "kernel";
    const tools = await semanticBrowser.events["session.started"]?.(
      {},
      context
    );
    expect(tools).toHaveProperty("playwright_execute");
    expect(
      await computerAction.events["session.started"]?.({}, context)
    ).not.toBeNull();
    expect(
      await captureImage.events["session.started"]?.({}, context)
    ).not.toBeNull();
  });
});
