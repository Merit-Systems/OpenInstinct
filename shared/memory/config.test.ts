import type { env } from "@shared/environment";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeMemoryModeForWorkspace } from "./config";

const settings = vi.hoisted<{
  KNOWLEDGE_MEMORY_MODE: typeof env.KNOWLEDGE_MEMORY_MODE;
  KNOWLEDGE_MEMORY_WORKSPACES: string | undefined;
}>(() => ({
  KNOWLEDGE_MEMORY_MODE: "off",
  KNOWLEDGE_MEMORY_WORKSPACES: undefined,
}));
vi.mock("@shared/environment", () => ({ env: settings }));

describe("knowledge memory rollout", () => {
  beforeEach(() => {
    settings.KNOWLEDGE_MEMORY_MODE = "off";
    settings.KNOWLEDGE_MEMORY_WORKSPACES = undefined;
  });

  it("is off by default", () => {
    expect(knowledgeMemoryModeForWorkspace("workspace-1")).toBe("off");
  });

  it("only enables workspaces explicitly listed when an allowlist is set", () => {
    settings.KNOWLEDGE_MEMORY_MODE = "enabled";
    settings.KNOWLEDGE_MEMORY_WORKSPACES = " workspace-1,workspace-2 ";
    expect(knowledgeMemoryModeForWorkspace("workspace-1")).toBe("enabled");
    expect(knowledgeMemoryModeForWorkspace("workspace-2")).toBe("enabled");
    expect(knowledgeMemoryModeForWorkspace("workspace")).toBe("off");
    expect(knowledgeMemoryModeForWorkspace("workspace-3")).toBe("off");
  });

  it("preserves shadow mode without requiring an allowlist", () => {
    settings.KNOWLEDGE_MEMORY_MODE = "shadow";
    expect(knowledgeMemoryModeForWorkspace("workspace-1")).toBe("shadow");
  });

  it("does not interpret an empty configured allowlist as all workspaces", () => {
    settings.KNOWLEDGE_MEMORY_MODE = "enabled";
    settings.KNOWLEDGE_MEMORY_WORKSPACES = ", ,";
    expect(knowledgeMemoryModeForWorkspace("workspace-1")).toBe("off");
  });
});
