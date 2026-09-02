import type { HookContext } from "eve/hooks";
import type { DrainContext, WideEvent } from "evlog";
import { initLogger } from "evlog";
import { resetEvlogEveForTests, useLogger } from "evlog/eve";
import { beforeAll, describe, expect, it } from "vitest";
import evlogHook from "@/agent/hooks/evlog";

const capturedEvents: WideEvent[] = [];

beforeAll(() => {
  resetEvlogEveForTests();
  initLogger({
    drain({ event }: DrainContext) {
      capturedEvents.push(structuredClone(event));
    },
    env: { service: "open-instinct-test" },
    redact: false,
    silent: true,
  });
});

describe("evlog hook", () => {
  it("emits full messages, appends turn observations, and isolates later turns", async () => {
    const first = hookContext("turn-1", 0);
    const second = hookContext("turn-2", 1);

    await emit("turn.started", turnStarted("turn-1", 0), first);
    await emit(
      "message.received",
      messageReceived(
        "turn-1",
        "email mason@example.com card 4111111111111111"
      ),
      first
    );
    const log = useLogger(first);
    log.set({
      channel: {
        linq: { reactions: [{ outcome: "accepted" }] },
      },
    });
    log.set({
      channel: {
        linq: { reactions: [{ outcome: "already-acknowledged" }] },
      },
    });
    await emit(
      "message.completed",
      messageCompleted("turn-1", "full response mason@example.com"),
      first
    );
    await emit("turn.completed", turnCompleted("turn-1"), first);

    await emit("turn.started", turnStarted("turn-2", 1), second);
    await emit(
      "message.received",
      messageReceived("turn-2", "next turn"),
      second
    );
    await emit(
      "message.completed",
      messageCompleted("turn-2", "next response"),
      second
    );
    await emit("turn.completed", turnCompleted("turn-2"), second);

    expect(capturedEvents).toHaveLength(2);
    expect(capturedEvents[0]).toMatchObject({
      channel: {
        kind: "linq",
        linq: {
          reactions: [
            { outcome: "accepted" },
            { outcome: "already-acknowledged" },
          ],
        },
      },
      message: {
        received: "email mason@example.com card 4111111111111111",
        response: "full response mason@example.com",
      },
    });
    expect(capturedEvents[1]).toMatchObject({
      channel: { kind: "linq" },
      message: { received: "next turn", response: "next response" },
    });
    expect(capturedEvents[1]).not.toHaveProperty("channel.linq");
  });
});

type EvlogEvents = NonNullable<typeof evlogHook.events>;

async function emit<Name extends keyof EvlogEvents>(
  name: Name,
  event: Parameters<NonNullable<EvlogEvents[Name]>>[0],
  context: HookContext
) {
  const handler = evlogHook.events?.[name];
  if (!handler) throw new Error(`Evlog handler ${name} is not configured.`);
  await handler(event, context);
}

function hookContext(turnId: string, sequence: number) {
  return {
    agent: { name: "root" },
    channel: { kind: "linq" },
    async getSandbox() {
      throw new Error("Sandbox access is outside this focused test.");
    },
    getSkill() {
      throw new Error("Skill access is outside this focused test.");
    },
    session: {
      auth: { current: null, initiator: null },
      id: "session-1",
      turn: { id: turnId, sequence },
    },
  } satisfies HookContext;
}

function turnStarted(turnId: string, sequence: number) {
  return {
    data: { sequence, turnId },
    meta: { at: "2026-08-31T22:00:00.000Z", id: `start-${turnId}` },
    type: "turn.started",
  } satisfies Parameters<NonNullable<EvlogEvents["turn.started"]>>[0];
}

function messageReceived(turnId: string, message: string) {
  return {
    data: { message, sequence: 1, turnId },
    meta: { at: "2026-08-31T22:00:01.000Z", id: `received-${turnId}` },
    type: "message.received",
  } satisfies Parameters<NonNullable<EvlogEvents["message.received"]>>[0];
}

function messageCompleted(turnId: string, message: string) {
  return {
    data: {
      finishReason: "stop",
      message,
      sequence: 2,
      stepIndex: 0,
      turnId,
    },
    meta: { at: "2026-08-31T22:00:02.000Z", id: `message-${turnId}` },
    type: "message.completed",
  } satisfies Parameters<NonNullable<EvlogEvents["message.completed"]>>[0];
}

function turnCompleted(turnId: string) {
  return {
    data: { sequence: 3, turnId },
    meta: { at: "2026-08-31T22:00:03.000Z", id: `complete-${turnId}` },
    type: "turn.completed",
  } satisfies Parameters<NonNullable<EvlogEvents["turn.completed"]>>[0];
}
