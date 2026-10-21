import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { MemoryTurnStartedContext, MemoryToolsContext } from "eve/memory";
import type { ToolContext } from "eve/tools";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as Database from "@db";
import * as schema from "@db/schema";
import { listMemorySources } from "@db/services/memory/sources";
import {
  readMemoryBinding,
  setMemoryCaptureDisabled,
} from "@db/services/memory/scope";
import {
  readMemoryRecord,
  editMemoryRecord,
} from "@db/services/memory/records";
import { patchUserProfile } from "@db/services/user-profile";
import personalInfo from "@agent/memory/personal_info";
import { z } from "zod";
import { memoryRecordContentSchema } from "@shared/memory/schema";

const feature = vi.hoisted(() => ({ mode: "enabled" }));
vi.mock("@shared/memory/config", () => ({
  knowledgeMemoryModeForWorkspace: () => feature.mode,
}));
import knowledge from "@agent/memory/knowledge";
import ingestion from "@agent/hooks/memory-ingestion";
import { directKnowledgeInputs } from "@agent/lib/memory/ingest";

const client = new PGlite();
const database = drizzle(client, { schema });
const scope = { userId: "user", workspaceId: "workspace" };

beforeAll(async () => {
  await migrate(database, { migrationsFolder: "db/migrations" });
  // SAFETY: The isolated PostgreSQL-compatible database has the same query-builder interface.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Only replace the database driver in this integration test.
  vi.spyOn(Database, "db", "get").mockReturnValue(database as never);
}, 20_000);
beforeEach(async () => {
  feature.mode = "enabled";
  await database.delete(schema.workspaces);
  await database.insert(schema.workspaces).values({ id: scope.workspaceId });
  await database
    .insert(schema.workspaceMemberships)
    .values({ ...scope, role: "owner" });
  await database.insert(schema.agentSessions).values(
    ["first", "fresh", "correct", "forget"].map((sessionId) => ({
      sessionId,
      workspaceId: scope.workspaceId,
      createdByUserId: scope.userId,
    }))
  );
});
afterAll(async () => {
  vi.restoreAllMocks();
  await client.close();
});

function context(
  sessionId: string,
  input = "",
  authenticator = "authjs",
  turnId = "turn"
) {
  return {
    abortSignal: new AbortController().signal,
    model: null,
    channel: {},
    getToken() {
      throw new Error("No tokens in memory tests.");
    },
    requireAuth() {
      throw new Error("No authentication changes in memory tests.");
    },
    getSandbox() {
      throw new Error("No sandbox in memory tests.");
    },
    memory: {
      scope: {
        key: "key",
        namespace: "test-knowledge",
        value: scope.workspaceId,
      },
      slot: "knowledge",
    },
    messages: [
      {
        role: "assistant",
        content: "Never capture recalled assistant claims.",
      },
    ],
    operationId: `${sessionId}-recall`,
    session: {
      turn: { id: turnId, sequence: 1 },
      id: sessionId,
      auth: {
        current: {
          attributes: { workspaceId: scope.workspaceId },
          authenticator,
          principalId: scope.userId,
          principalType: "user",
        },
        initiator: null,
      },
    },
    turn: {
      id: turnId,
      input: input
        ? [
            Object.assign(
              { role: "user" as const, content: input },
              { kind: "user" }
            ),
          ]
        : [],
      sequence: 1,
    },
  } satisfies MemoryTurnStartedContext &
    MemoryToolsContext &
    Omit<ToolContext, "callId" | "toolName">;
}
async function receive(
  current: ReturnType<typeof context>,
  observedAt = new Date().toISOString()
) {
  const message = directKnowledgeInputs(current.turn.input).join("\n");
  const handler = ingestion.events?.["message.received"];
  if (!handler) throw new Error("Expected receipt hook.");
  await handler(
    {
      type: "message.received",
      data: {
        message,
        turnId: current.turn.id,
        sequence: current.turn.sequence,
      },
      meta: {
        id: `receipt-${current.session.id}`,
        at: observedAt,
      },
    },
    { ...current, agent: { name: "root" } }
  );
}
async function toolsFor(current: ReturnType<typeof context>) {
  const tools = await knowledge.provider.tools(current);
  await receive(current);
  return tools;
}

async function remember() {
  const current = context(
    "first",
    "Please remember: I prefer quiet train cars."
  );
  const tools = await toolsFor(current);
  if (!tools) throw new Error("Expected knowledge tools.");
  const saved = await tools.remember.execute(
    { kind: "preference", body: "I prefer quiet train cars." },
    { ...current, callId: "save", toolName: "knowledge__remember" }
  );
  if (!("id" in saved)) throw new Error("Expected a saved record.");
  return { saved, current, tools };
}

describe("knowledge memory across fresh agent contexts", () => {
  it.each(["authorization.required", "input.requested"] as const)(
    "preserves earlier explicit memories when %s excludes the current exchange",
    async (eventType) => {
      const start = Date.now() + 1_000;
      const facts = await Promise.all(
        ["earlier-one", "earlier-two", "requesting-turn", "racing-reply"].map(
          async (turnId, index) => {
            const body = `I prefer the ${turnId} option.`;
            const current = context(
              "first",
              `Please remember: ${body}`,
              "authjs",
              turnId
            );
            const tools = await knowledge.provider.tools(current);
            if (!tools) throw new Error("Expected knowledge tools.");
            await receive(
              current,
              new Date(start + index * 1_000).toISOString()
            );
            const saved = await tools.remember.execute(
              { kind: "preference", body },
              { ...current, callId: turnId, toolName: "knowledge__remember" }
            );
            if (!("id" in saved)) throw new Error("Expected a saved record.");
            return saved.id;
          }
        )
      );
      const current = {
        ...context("first", "", "authjs", "different-context-turn"),
        agent: { name: "root" },
      };
      const event = {
        data: { sequence: 1, stepIndex: 0, turnId: "requesting-turn" },
        meta: {
          id: "capture-boundary",
          at: new Date(start + 2_500).toISOString(),
        },
      };
      if (eventType === "input.requested") {
        await ingestion.events?.[eventType]?.(
          {
            ...event,
            type: eventType,
            data: { ...event.data, requests: [] },
          },
          current
        );
      } else {
        await ingestion.events?.[eventType]?.(
          {
            ...event,
            type: eventType,
            data: {
              ...event.data,
              name: "connection",
              description: "Authorize connection",
            },
          },
          current
        );
      }
      const records = await Promise.all(
        facts.map((id) => readMemoryRecord(scope, "key", id))
      );
      expect(records.slice(0, 2).every((record) => record?.explicit)).toBe(
        true
      );
      expect(records.slice(2)).toEqual([null, null]);
      expect(await readMemoryBinding(scope, "first")).toMatchObject({
        captureDisabled: true,
      });
      await receive(context("first", "MangoTreeIsMySecret", "authjs", "later"));
      expect(
        (await listMemorySources(scope, "key"))
          .map((source) => source.turnId ?? "")
          .toSorted((left, right) => left.localeCompare(right))
      ).toEqual(["earlier-one", "earlier-two"]);
    }
  );

  it("cleans up unused control input when its original turn completes", async () => {
    const current = context("first", "Please update the spreadsheet.");
    await toolsFor(current);
    expect(await listMemorySources(scope, "key")).toHaveLength(1);
    await ingestion.events?.["turn.completed"]?.(
      {
        type: "turn.completed",
        data: { sequence: 1, turnId: current.turn.id },
        meta: { id: "completed", at: new Date().toISOString() },
      },
      {
        ...context("first", "", "authjs", "different-context-turn"),
        agent: { name: "root" },
      }
    );
    expect(await listMemorySources(scope, "key")).toEqual([]);
  });

  it("never invents a receipt time for an old uncaptured turn", async () => {
    const stale = context("first", "Please remember I prefer old preferences.");
    const tools = await knowledge.provider.tools(stale);
    if (!tools) throw new Error("Expected tools.");
    await knowledge.provider.recall["turn.started"](stale);
    expect(await listMemorySources(scope, "key")).toEqual([]);
    await expect(
      tools.remember.execute(
        { kind: "preference", body: "I prefer old preferences." },
        { ...stale, callId: "old", toolName: "knowledge__remember" }
      )
    ).rejects.toThrow("original receipt is unavailable");
    await receive(stale);
    await expect(
      tools.remember.execute(
        { kind: "preference", body: "I prefer old preferences." },
        { ...stale, callId: "new", toolName: "knowledge__remember" }
      )
    ).resolves.toMatchObject({ revision: 1 });
  });

  it("bounds recall with complete JSON records and replaces an emptied Personal Info recall", async () => {
    await toolsFor(context("first"));
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        editMemoryRecord(
          scope,
          "key",
          {
            id: `long-${String(index)}`,
            expectedRevision: 0,
            kind: "preference",
            title: `Preference ${String(index)}`,
            body: `I prefer ${"quiet ".repeat(400)}cars.`,
          },
          `long-${String(index)}`
        )
      )
    );
    const recall = await knowledge.provider.recall["turn.started"](
      context("fresh")
    );
    const json =
      recall.messages[0]?.content.split("\n").slice(1).join("\n") ?? "";
    const bundle = z
      .object({
        records: z.array(z.object({ content: memoryRecordContentSchema })),
      })
      .parse(JSON.parse(json));
    expect(json.length).toBeLessThanOrEqual(17_000);
    expect(bundle.records.length).toBeGreaterThan(0);
    expect(bundle.records.length).toBeLessThan(8);
    expect(
      bundle.records.every((record) => record.content.body.endsWith("cars."))
    ).toBe(true);
    await patchUserProfile(scope, { firstName: "Alex" });
    const populated = await personalInfo.provider.recall["turn.started"](
      context("first")
    );
    await patchUserProfile(scope, { firstName: null });
    const empty = await personalInfo.provider.recall["turn.started"](
      context("fresh")
    );
    expect(empty?.messages[0]?.id).toBe(populated?.messages[0]?.id);
    expect(empty?.messages[0]?.content).toContain("Personal Info is empty");
    expect(empty?.messages[0]?.content).not.toContain("Alex");
  });

  it("recalls an explicit fact, applies a correction immediately, and removes all derived recall after forgetting", async () => {
    const { saved } = await remember();
    const fresh = context("fresh", "What train cars do I prefer?");
    const before = await knowledge.provider.recall["turn.started"](fresh);
    expect(before.messages[0]?.content).toContain("I prefer quiet train cars.");
    const corrected = context(
      "correct",
      "Actually, change my preference: I prefer lively train cars."
    );
    const tools = await toolsFor(corrected);
    if (!tools) throw new Error("Expected correction tools.");
    await tools.correct.execute(
      {
        id: saved.id,
        expectedRevision: 1,
        kind: "preference",
        body: "I prefer lively train cars.",
      },
      { ...corrected, callId: "correct", toolName: "knowledge__correct" }
    );
    const later = await knowledge.provider.recall["turn.started"]({
      ...fresh,
      operationId: "after-correction",
    });
    expect(later.messages[0]?.content).toContain("I prefer lively train cars.");
    expect(later.messages[0]?.content).not.toContain(
      "I prefer quiet train cars."
    );
    const deletion = context(
      "forget",
      "Please forget my train-car preference."
    );
    const forgetTools = await toolsFor(deletion);
    if (!forgetTools) throw new Error("Expected deletion tools.");
    await forgetTools.forget.execute(
      { id: saved.id, expectedRevision: 2 },
      { ...deletion, callId: "forget", toolName: "knowledge__forget" }
    );
    const after = await knowledge.provider.recall["turn.started"]({
      ...fresh,
      operationId: "after-forget",
    });
    expect(after.messages[0]?.id).toBe(before.messages[0]?.id);
    expect(after.messages[0]?.content).not.toContain("train cars");
    expect(await readMemoryRecord(scope, "key", saved.id)).toBeNull();
    await expect(
      knowledge.provider.recall["turn.started"](fresh)
    ).rejects.toThrow("invalidated");
  });

  it("keeps recall stable on workflow replay and never ingests recalled context", async () => {
    const { saved } = await remember();
    const current = context("fresh", "I like hiking.");
    const first = await knowledge.provider.recall["turn.started"](current);
    await receive(current);
    const corrected = context(
      "correct",
      "Update this: I prefer lively train cars."
    );
    const tools = await toolsFor(corrected);
    if (!tools) throw new Error("Expected tools.");
    await tools.correct.execute(
      {
        id: saved.id,
        expectedRevision: 1,
        kind: "preference",
        body: "I prefer lively train cars.",
      },
      { ...corrected, callId: "correct", toolName: "knowledge__correct" }
    );
    expect(await knowledge.provider.recall["turn.started"](current)).toEqual(
      first
    );
    const sources = await listMemorySources(scope, "key");
    expect(
      sources.some((source) => source.text?.includes("recalled assistant"))
    ).toBe(false);
    expect(
      sources.filter((source) => source.text === "I like hiking.")
    ).toHaveLength(1);
  });

  it("leaves off mode inert, allows shadow capture without facts or tools, and disables scheduled workers", async () => {
    const current = context("first", "I prefer quiet train cars.");
    feature.mode = "off";
    expect(await toolsFor(current)).toBeNull();
    expect(
      (await knowledge.provider.recall["turn.started"](current)).messages[0]
        ?.content
    ).not.toContain("quiet");
    expect(await database.select().from(schema.memoryBindings)).toEqual([]);
    feature.mode = "shadow";
    expect(await toolsFor(current)).toBeNull();
    expect(await readMemoryBinding(scope, "first")).not.toBeNull();
    expect(
      (await knowledge.provider.recall["turn.started"](current)).messages[0]
        ?.content
    ).not.toContain("quiet");
    expect(await listMemorySources(scope, "key")).toHaveLength(1);
    feature.mode = "enabled";
    await Promise.all(
      ["scheduled-worker", "scheduled-result"].map(async (mode) => {
        const scheduled = context("fresh", "I prefer bright rooms.", mode);
        expect(knowledge.scope(scheduled)).toBeNull();
        expect(await toolsFor(scheduled)).toBeNull();
      })
    );
  });

  it("requires exact current user evidence for edits and rejects sensitive-session capture", async () => {
    const current = context("first", "How are you?");
    const tools = await toolsFor(current);
    if (!tools) throw new Error("Expected tools.");
    await expect(
      tools.remember.execute(
        { kind: "preference", body: "I prefer red." },
        { ...current, callId: "fabricated", toolName: "knowledge__remember" }
      )
    ).rejects.toThrow("explicit current user request");
    await setMemoryCaptureDisabled(scope, "key", "first", {
      turnId: current.turn.id,
      observedAt: new Date().toISOString(),
    });
    const request = context("first", "Remember that I prefer red.");
    const disabledTools = await toolsFor(request);
    if (!disabledTools) throw new Error("Expected tools.");
    await expect(
      disabledTools.remember.execute(
        { kind: "preference", body: "I prefer red." },
        { ...request, callId: "disabled", toolName: "knowledge__remember" }
      )
    ).rejects.toThrow("Memory capture is disabled for this chat");
    expect(
      (await listMemorySources(scope, "key")).every((source) => !source.text)
    ).toBe(true);
  });
});
