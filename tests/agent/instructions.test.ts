import type { DynamicResolveContext } from "eve/instructions";
import { describe, expect, it } from "vitest";
import instructions from "@/agent/instructions";

describe("agent instructions", () => {
  it.each([
    ["scheduled-worker", "isolated background session"],
    ["scheduled-result", "evaluating the completed outcome"],
    ["linq", "root coordinator"],
  ])("selects %s instructions for the current turn", async (role, phrase) => {
    const resolve = instructions.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const selected = await resolve({}, dynamicContext(role));
    expect(selected?.content).toContain(phrase);
  });

  it("limits scheduled-result turns to reporting", async () => {
    const resolve = instructions.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const selected = await resolve({}, dynamicContext("scheduled-result"));
    expect(selected?.content).toContain(
      "Never invoke another agent, alter a schedule or profile, access an account"
    );
  });
});

function dynamicContext(authenticator: string) {
  return {
    channel: { kind: "channel:linq", metadata: {} },
    messages: [],
    session: {
      auth: {
        current: {
          attributes: {},
          authenticator,
          principalId: "user-1",
          principalType: "user",
        },
        initiator: null,
      },
      id: "session-1",
    },
  } satisfies DynamicResolveContext;
}
