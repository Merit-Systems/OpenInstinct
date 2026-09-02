import type { DynamicResolveContext } from "eve/instructions";
import { describe, expect, it } from "vitest";
import executionSafety from "@/agent/instructions/10-execution-safety";
import roleInstructions from "@/agent/instructions/20-role";
import workerCoordination from "@/agent/instructions/25-worker-coordination";
import messageStyle from "@/agent/instructions/30-message-style";

describe("agent instructions", () => {
  it.each([
    ["scheduled-worker", "isolated background session"],
    ["scheduled-result", "evaluating the completed outcome"],
    ["linq", "root coordinator"],
  ])("selects %s instructions for the current turn", async (role, phrase) => {
    const resolve = roleInstructions.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const selected = await resolve({}, dynamicContext(role));
    expect(selected?.content).toContain(phrase);
  });

  it("limits scheduled-result turns to reporting", async () => {
    const resolve = roleInstructions.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const selected = await resolve({}, dynamicContext("scheduled-result"));
    expect(selected?.content).toContain(
      "Never invoke another agent, alter a schedule or profile, read or change vault contents, access an account"
    );
    expect(selected?.content).toContain(
      "call `request_vault_setup` with only the safe metadata"
    );
  });

  it("omits execution safety from scheduled reports", async () => {
    const resolve = executionSafety.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    expect(await resolve({}, dynamicContext("scheduled-result"))).toBeNull();
    const selected = await resolve({}, dynamicContext("scheduled-worker"));
    expect(selected?.content).toContain("approval");
  });

  it("omits message style from scheduled workers", async () => {
    const resolve = messageStyle.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    expect(await resolve({}, dynamicContext("scheduled-worker"))).toBeNull();
    const selected = await resolve({}, dynamicContext("scheduled-result"));
    expect(selected?.content).toContain("natural text message");
  });

  it("shares the exact browser contract with scheduled workers", async () => {
    const resolve = workerCoordination.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const selections = await Promise.all(
      ["linq", "scheduled-worker"].map((authenticator) =>
        Promise.resolve(resolve({}, dynamicContext(authenticator)))
      )
    );
    for (const selected of selections) {
      expect(selected?.content).toContain(
        "Every initial or resumed `worker` call must set `outputSchema`"
      );
      expect(selected?.content).toContain(
        '"required": ["status", "message", "images"]'
      );
      expect(selected?.content).toContain(
        "native `final_output` tool exactly once"
      );
    }

    expect(await resolve({}, dynamicContext("scheduled-result"))).toBeNull();
  });

  it("keeps resumed scheduled turns in worker mode", async () => {
    const resolve = roleInstructions.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const selected = await resolve(
      {},
      dynamicContext("linq-message", "scheduled-worker")
    );
    expect(selected?.content).toContain("isolated background session");
  });
});

function dynamicContext(
  authenticator: string,
  initiatorAuthenticator?: string
) {
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
        initiator:
          initiatorAuthenticator === undefined
            ? null
            : {
                attributes: {},
                authenticator: initiatorAuthenticator,
                principalId: "user-1",
                principalType: "user",
              },
      },
      id: "session-1",
    },
  } satisfies DynamicResolveContext;
}
