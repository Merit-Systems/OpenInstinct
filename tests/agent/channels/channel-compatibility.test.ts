import type { AudienceContext } from "eve/channels";
import type * as CompiledChannel from "../../../node_modules/eve/dist/src/channel/compiled-channel.js";
import { describe, expect, it, vi } from "vitest";
import eve from "@agent/channels/eve";
import scheduledRun from "@agent/channels/scheduled-run";

const { isCompiledChannel } = await vi.importActual<typeof CompiledChannel>(
  new URL("./channel/compiled-channel.js", import.meta.resolve("eve")).pathname
);

describe("compiled channel compatibility", () => {
  it("preserves HTTP delivery hooks after wrapping its ownership routes", () => {
    if (!isCompiledChannel(eve))
      throw new Error("Expected a compiled channel.");

    expect(eve.adapter["action.result"]).toBeUndefined();
    expect(eve.adapter["message.completed"]).toBeTypeOf("function");
    expect(eve.adapter["turn.failed"]).toBeTypeOf("function");
  });

  it.each([
    { channel: eve, anonymousAudience: "unknown" },
    { channel: scheduledRun, anonymousAudience: "unknown" },
  ])(
    "keeps authenticated conversations private",
    ({ channel, anonymousAudience }) => {
      if (!isCompiledChannel(channel))
        throw new Error("Expected a compiled channel.");
      const audience = channel.adapter.instrumentation?.audience;
      if (!audience) throw new Error("Expected a native audience classifier.");
      const input = {
        channel: { kind: "http" },
        environment: "production",
        mode: "conversation",
        caller: {
          type: "principal",
          principal: {
            kind: "user",
            authenticator: "scheduled-worker",
            attributes: {},
          },
        },
        state: undefined,
        // oxlint-disable-next-line typescript/no-deprecated -- Eve still requires the legacy field in the compiled adapter contract.
        auth: {
          attributes: {},
          authenticator: "scheduled-worker",
          principalType: "user",
        },
      } satisfies AudienceContext<undefined>;

      expect(audience(input)).toBe("private");
      expect(
        // oxlint-disable-next-line typescript/no-deprecated -- Exercise anonymous projection of the compiled adapter contract.
        audience({ ...input, auth: null, caller: { type: "anonymous" } })
      ).toBe(anonymousAudience);
    }
  );
});
