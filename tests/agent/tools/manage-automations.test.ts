import type { ToolContext } from "eve/tools";
import { describe, expect, it, vi } from "vitest";
import manageAutomations from "@/agent/tools/manage_automations";

describe("automation management authorization", () => {
  it("prevents an automation-authenticated task from mutating the control plane", async () => {
    await expect(
      manageAutomations.execute(
        {
          action: "create",
          task: "Create another automation.",
          timezone: "America/New_York",
          title: "Recursive automation",
          trigger: { at: "2030-01-01T09:00:00.000-05:00", kind: "at" },
        },
        automationContext()
      )
    ).rejects.toThrow(
      "Automation runs cannot change the automation control plane."
    );
  });
});

function automationContext() {
  const getToken = vi.fn<ToolContext["getToken"]>();
  const requireAuth = vi.fn<ToolContext["requireAuth"]>();
  return {
    abortSignal: new AbortController().signal,
    callId: "call-1",
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    getToken,
    requireAuth,
    session: {
      auth: {
        current: {
          attributes: {
            automationId: "automation-1",
            phoneNumber: "+12025550123",
            workspaceId: "workspace-1",
          },
          authenticator: "automation",
          principalId: "user-1",
          principalType: "user" as const,
        },
        initiator: null,
      },
      id: "automation-session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
    toolName: "manage_automations",
  } satisfies ToolContext;
}
