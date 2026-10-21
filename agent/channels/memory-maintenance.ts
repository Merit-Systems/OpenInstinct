import { defineChannel, POST, type AttachSessionFn } from "eve/channels";
import { localDev, routeAuth, vercelOidc } from "eve/channels/auth";
import type { MessageStreamEvent } from "eve/client";
import { z } from "zod";
import { knowledgeInputSource } from "@agent/lib/memory/ingest";
import { listMemorySessionBindings } from "@db/services/memory/scope";
import { recordMemoryRecovery } from "@db/services/memory/sources";
import { env } from "@shared/environment";
import { knowledgeMemoryModeForWorkspace } from "@shared/memory/config";

const internalRouteAuth = [vercelOidc(), localDev()];
const requestSchema = z.strictObject({});
const eventsPerRead = 128;

export default defineChannel({
  routes: [
    POST("/internal/memory-maintenance/recover", async (request, context) => {
      const auth = await routeAuth(request, internalRouteAuth);
      if (auth instanceof Response) return auth;
      const input = requestSchema.safeParse(
        await request.json().catch(() => null)
      );
      if (!input.success) return new Response(null, { status: 400 });
      if (env.KNOWLEDGE_MEMORY_MODE === "off") {
        return Response.json({ scanned: 0 });
      }
      const workspaceIds = env.KNOWLEDGE_MEMORY_WORKSPACES?.split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const bindings = await listMemorySessionBindings(8, workspaceIds);
      const results = await Promise.allSettled(
        bindings.map((binding) =>
          recoverSession(context.attachSession, binding)
        )
      );
      const failed = results.filter(
        (result) => result.status === "rejected"
      ).length;
      return Response.json(
        { scanned: results.length - failed, failed },
        { status: failed ? 503 : 200 }
      );
    }),
  ],
});

async function recoverSession(
  attachSession: AttachSessionFn,
  binding: Awaited<ReturnType<typeof listMemorySessionBindings>>[number]
) {
  if (knowledgeMemoryModeForWorkspace(binding.scope.workspaceId) === "off")
    return;
  const session = attachSession(binding.sessionId);
  const tail = await session.getStreamTailIndex();
  const end = Math.min(tail + 1, binding.cursor + eventsPerRead);
  if (end <= binding.cursor) {
    await recordMemoryRecovery(
      binding.scope,
      binding.scopeKey,
      binding.sessionId,
      {
        expectedCursor: binding.cursor,
        nextCursor: binding.cursor,
        sources: [],
      }
    );
    return;
  }
  const stream = await session.getEventStream({ startIndex: binding.cursor });
  const reader = stream.getReader();
  const events: MessageStreamEvent[] = [];
  const timeout = setTimeout(() => void reader.cancel(), 10_000);
  try {
    while (events.length < end - binding.cursor) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Consume a bounded snapshot in stream order before advancing its durable cursor.
      const next = await reader.read();
      if (next.done) break;
      events.push(next.value);
    }
  } finally {
    clearTimeout(timeout);
    await reader.cancel();
    reader.releaseLock();
  }
  const eligible = events.filter(
    (event) => new Date(event.meta.at) >= binding.captureAfter
  );
  const captureBoundaries = events.flatMap((event) =>
    event.type === "authorization.required" || event.type === "input.requested"
      ? [{ turnId: event.data.turnId, observedAt: event.meta.at }]
      : []
  );
  const captureDisabled =
    binding.captureDisabled || captureBoundaries.length > 0;
  const finishedTurnIds = events.flatMap((event) =>
    event.type === "turn.completed" ||
    event.type === "turn.failed" ||
    event.type === "turn.cancelled"
      ? [event.data.turnId]
      : []
  );
  const sources = captureDisabled
    ? []
    : eligible.flatMap((event) => {
        if (event.type !== "message.received") return [];
        const text = event.data.parts
          ? event.data.parts
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
          : event.data.message;
        const source = knowledgeInputSource({
          sessionId: binding.sessionId,
          turnId: event.data.turnId,
          text,
          observedAt: event.meta.at,
          kind: event.data.kind,
          eventId: event.meta.id,
        });
        return source ? [source] : [];
      });
  await recordMemoryRecovery(
    binding.scope,
    binding.scopeKey,
    binding.sessionId,
    {
      expectedCursor: binding.cursor,
      nextCursor: binding.cursor + events.length,
      sources,
      captureBoundaries,
      finishedTurnIds,
    }
  );
}
