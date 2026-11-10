import type * as Environment from "@shared/environment";
import { describe, expect, it, vi } from "vitest";
import semanticBrowser from "@agent/subagents/browser-agent/tools/semantic_browser";
import computerAction from "@agent/subagents/browser-agent/tools/computer_action";
import captureImage from "@agent/subagents/browser-agent/tools/capture_browser_image";
import { resolveDynamicTool } from "@tests/helpers/resolve-dynamic-tool";

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
describe("provider tool selection", () => {
  it("exposes semantic CDP tools and omits Kernel-only tools with Notte", async () => {
    const tools = await resolveDynamicTool(semanticBrowser);
    expect(Object.keys(tools ?? {})).toEqual([
      "browser_snapshot",
      "browser_text",
      "browser_find",
      "browser_wait_for",
      "browser_act",
    ]);
    expect(await resolveDynamicTool(computerAction)).toBeNull();
    expect(await resolveDynamicTool(captureImage)).toBeNull();
  });

  it("keeps the full Kernel tool surface by default", async () => {
    settings.provider = "kernel";
    const tools = await resolveDynamicTool(semanticBrowser);
    expect(tools).toHaveProperty("playwright_execute");
    expect(await resolveDynamicTool(computerAction)).not.toBeNull();
    expect(await resolveDynamicTool(captureImage)).not.toBeNull();
  });
});
