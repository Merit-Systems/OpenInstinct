import type { SessionAuth } from "eve/context";
import type { HookContext } from "eve/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stateControls = vi.hoisted(() => ({
  // SAFETY: The array is populated only with zero-argument reset callbacks created by this mock.
  reset: [] as (() => void)[],
}));

vi.mock("eve/context", () => ({
  defineState<T>(_name: string, initial: () => T) {
    let value = initial();
    stateControls.reset.push(() => {
      value = initial();
    });
    return {
      get: () => value,
      update(update: (current: T) => T) {
        value = update(value);
      },
    };
  },
}));

import backgroundReplyTargetHook from "@/agent/hooks/background-reply-target";
import {
  registerBackgroundReplyTarget,
  resolveLinqReplyTarget,
} from "@/agent/lib/reply-targets";

beforeEach(() => {
  for (const reset of stateControls.reset) reset();
});

describe("reply targets", () => {
  it("resolves the current Linq message without exposing its provider ID", () => {
    expect(
      resolveLinqReplyTarget({ kind: "current" }, linqAuth("message-1"))
    ).toEqual({
      conversationId: "linq:dm:chat-1",
      messageId: "message-1",
    });
  });

  it("keeps a background task attached to its initiating message", () => {
    registerBackgroundReplyTarget("task-1", linqAuth("origin-message"));

    expect(
      resolveLinqReplyTarget(
        { id: "task-1", kind: "task" },
        backgroundWakeAuth()
      )
    ).toEqual({
      conversationId: "linq:dm:chat-1",
      messageId: "origin-message",
    });
  });

  it("does not resolve a task handle in another conversation", () => {
    registerBackgroundReplyTarget("task-1", linqAuth("origin-message"));

    expect(
      resolveLinqReplyTarget(
        { id: "task-1", kind: "task" },
        linqAuth("later-message", "linq:dm:chat-2")
      )
    ).toBeUndefined();
  });

  it("registers background subagent receipts through the public hook", async () => {
    const handler = backgroundReplyTargetHook.events?.["subagent.completed"];
    await handler?.(
      {
        data: {
          backgroundTask: { status: "working", taskId: "task-from-hook" },
          callId: "call-1",
          output: "Delegated",
          subagentName: "worker",
        },
        meta: { at: "2026-09-03T12:00:00.000Z", id: "event-1" },
        type: "subagent.completed",
      },
      hookContext(linqAuth("hook-origin"))
    );

    expect(
      resolveLinqReplyTarget(
        { id: "task-from-hook", kind: "task" },
        linqAuth("later-message")
      )
    ).toMatchObject({ messageId: "hook-origin" });
  });

  it("resolves only the automation handle supplied by the reporting turn", () => {
    const auth = scheduledReportAuth("original-message");

    expect(
      resolveLinqReplyTarget(
        {
          id: "00000000-0000-4000-8000-000000000003",
          kind: "automation",
        },
        auth
      )
    ).toEqual({
      conversationId: "linq:dm:chat-1",
      messageId: "original-message",
    });
    expect(
      resolveLinqReplyTarget(
        {
          id: "00000000-0000-4000-8000-000000000099",
          kind: "automation",
        },
        auth
      )
    ).toBeUndefined();
  });
});

function linqAuth(
  messageId: string,
  conversationId = "linq:dm:chat-1"
): SessionAuth {
  return {
    current: {
      attributes: {
        conversationChannel: "linq",
        conversationId,
        linqMessageId: messageId,
      },
      authenticator: "linq",
      principalId: "user-1",
      principalType: "user",
    },
    initiator: null,
  };
}

function scheduledReportAuth(messageId: string): SessionAuth {
  return {
    current: {
      attributes: {
        conversationChannel: "linq",
        conversationId: "linq:dm:chat-1",
        linqReplyAnchorMessageId: messageId,
        scheduleId: "00000000-0000-4000-8000-000000000003",
        scheduledReportLeaseToken: "00000000-0000-4000-8000-000000000004",
        scheduledReportSequence: "1",
        scheduledRunId: "00000000-0000-4000-8000-000000000002",
      },
      authenticator: "scheduled-result",
      principalId: "user-1",
      principalType: "user",
    },
    initiator: null,
  };
}

function backgroundWakeAuth(): SessionAuth {
  return {
    current: null,
    initiator: linqAuth("origin-message").current,
  };
}

function hookContext(auth: SessionAuth): HookContext {
  return {
    agent: { name: "main" },
    channel: { kind: "channel:linq" },
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    session: {
      auth,
      id: "session-1",
      turn: { id: "turn-1", sequence: 0 },
    },
  };
}
