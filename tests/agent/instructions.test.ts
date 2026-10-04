import type { DynamicResolveContext } from "eve/instructions";
import { describe, expect, it } from "vitest";
import executionSafety from "@agent/instructions/10-execution-safety";
import roleInstructions from "@agent/instructions/20-role";
import workerCoordination from "@agent/instructions/25-worker-coordination";
import messageStyle from "@agent/instructions/30-message-style";

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
    expect(selected?.content).toContain(
      "After `send_message`, emit only `DELIVERY_COMPLETE`"
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

  it("avoids tool approval loops while retaining actual Link purchase approval", async () => {
    const resolve = executionSafety.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const selected = await resolve({}, dynamicContext("linq-message"));
    expect(selected?.content).toContain(
      "Tools run without a separate Eve approval step"
    );
    expect(selected?.content).toContain(
      "Purchases through Link still require approval in Link"
    );
    expect(selected?.content).not.toContain("native approval card");
  });

  it("treats personal information as recalled context instead of a read tool", async () => {
    const resolve = roleInstructions.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const selected = await resolve({}, dynamicContext("linq-message"));
    expect(selected?.content).toContain(
      "never call `personal_info__update` to read it"
    );
    expect(selected?.content).toContain(
      "say plainly when a requested value is not present"
    );
    expect(selected?.content).toContain(
      "never import third-party claims or task details into those slots"
    );
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
        "tool supplies the required structured completion schema"
      );
      expect(selected?.content).toContain(
        "native `final_output` tool exactly once"
      );
    }

    expect(await resolve({}, dynamicContext("scheduled-result"))).toBeNull();
  });

  it("approves Link purchases for the checkout the worker keeps open", async () => {
    const resolve = workerCoordination.events["turn.started"];
    expect(resolve).toBeDefined();
    if (!resolve) return;

    const selected = await resolve({}, dynamicContext("linq"));
    expect(selected?.content).toContain(
      "setting `merchant_url` to the worker's reported checkout URL"
    );
    expect(selected?.content).toContain("keep that checkout open for approval");
    expect(selected?.content).toContain(
      "unless the worker's latest result says it kept the browser open"
    );
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
    model: null,
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
