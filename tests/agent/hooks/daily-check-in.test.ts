import type { HookContext } from "eve/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import dailyCheckIn from "@agent/hooks/daily-check-in";
import type { ensureDailyCheckIn } from "@db/services/conversation-wakeups";

const ensure = vi.hoisted(() => vi.fn<typeof ensureDailyCheckIn>());
vi.mock("@db/services/conversation-wakeups", () => ({
  ensureDailyCheckIn: ensure,
}));
const context = {
  agent: { name: "agent" },
  channel: { kind: "channel:linq" },
  getSandbox() {
    throw new Error("Unused");
  },
  getSkill() {
    throw new Error("Unused");
  },
  session: {
    id: "main",
    turn: { id: "turn", sequence: 1 },
    auth: {
      initiator: null,
      current: {
        authenticator: "linq-message",
        principalType: "user",
        principalId: "alice",
        attributes: {
          workspaceId: "alice-workspace",
          conversationChannel: "linq",
          conversationId: "linq:alice",
          linqIsDM: "true",
        },
      },
    },
  },
} satisfies HookContext;
const event = {
  type: "message.received" as const,
  data: { message: "Hello", sequence: 1, turnId: "turn" },
  meta: { at: "2026-09-08T12:00:00Z", id: "event" },
};
beforeEach(() => vi.clearAllMocks());
describe("default check-in enrollment", () => {
  it("enrolls an authenticated direct message", async () => {
    await dailyCheckIn.events?.["message.received"]?.(event, context);
    expect(ensure).toHaveBeenCalledExactlyOnceWith(
      { userId: "alice", workspaceId: "alice-workspace" },
      "linq:alice",
      expect.stringContaining("OODA")
    );
  });
  it("does not enroll web chats, groups, scheduled turns, or anonymous users", async () => {
    const caller = context.session.auth.current;
    for (const current of [
      null,
      { ...caller, authenticator: "scheduled-wakeup" },
      { ...caller, attributes: { ...caller.attributes, linqIsDM: "false" } },
      {
        ...caller,
        attributes: { ...caller.attributes, conversationChannel: "eve" },
      },
    ]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Exercise independent hook contexts sequentially.
      await dailyCheckIn.events?.["message.received"]?.(event, {
        ...context,
        session: { ...context.session, auth: { initiator: caller, current } },
      });
    }
    expect(ensure).not.toHaveBeenCalled();
  });
});
