import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Database from "@/db";
import * as schema from "../schema";
import {
  browserTraceDomains as browserTraceDomainsTable,
  browserTraces as browserTracesTable,
} from "../schema";

const databases: PGlite[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("database services", () => {
  it("preserves workspace ownership across application domains", async () => {
    const client = new PGlite();
    databases.push(client);
    await applyInitialMigration(client);
    await applyBrowserImageMigration(client);
    await applyBrowserTraceMigration(client);
    await applyBrowserTraceEventMigration(client);

    const pgliteDatabase = drizzle(client, { schema });
    // SAFETY: PGlite implements the query-builder surface exercised by these services despite using a different Drizzle driver.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- This test swaps only the driver while retaining the shared Drizzle schema and query-builder contract.
    const database = pgliteDatabase as never;
    vi.spyOn(Database, "db", "get").mockReturnValue(database);

    const [
      browserImages,
      browsers,
      browserTraces,
      chats,
      secrets,
      sessions,
      settings,
      scope,
      vault,
    ] = await Promise.all([
      import("@/db/services/browser-images"),
      import("@/db/services/browsers"),
      import("@/db/services/browser-traces"),
      import("@/db/services/chats"),
      import("@/db/services/secrets"),
      import("@/db/services/sessions"),
      import("@/db/services/settings"),
      import("@/db/services/scope"),
      import("@/db/services/vault"),
    ]);
    const alice = { userId: "alice", workspaceId: "workspace:alice" };
    const bob = { userId: "bob", workspaceId: "workspace:bob" };

    await scope.ensureScope(alice);
    await scope.ensureScope(bob);

    const imageInput = {
      browserSessionId: "browser-alice",
      idempotencyKey: "worker-session:call-image",
      label: "Product image",
      rootSessionId: "session-alice",
      sourceKind: "viewport",
      workerSessionId: "worker-alice",
    };
    const firstReservation = await browserImages.reserveBrowserImageArtifact(
      alice,
      imageInput
    );
    const retryReservation = await browserImages.reserveBrowserImageArtifact(
      alice,
      imageInput
    );
    expect(firstReservation.status).toBe("pending");
    expect(retryReservation).toEqual(firstReservation);
    if (firstReservation.status !== "pending") {
      throw new Error("Expected a pending browser image reservation.");
    }
    const finalized = await browserImages.finalizeBrowserImageArtifact(
      alice,
      firstReservation.reservation,
      {
        byteSize: 8,
        contentHash: "content-hash",
        filename: "product.png",
        mediaType: "image/png",
        sourceKind: "viewport",
        storagePathname: `${firstReservation.reservation.storagePathname}/content-hash`,
      }
    );
    const image = finalized.image;
    expect(image).toMatchObject({
      byteSize: 8,
      label: "Product image",
      mediaType: "image/png",
    });
    await expect(
      browserImages.finalizeBrowserImageArtifact(
        alice,
        firstReservation.reservation,
        {
          byteSize: 9,
          contentHash: "losing-content-hash",
          filename: "losing.png",
          mediaType: "image/png",
          sourceKind: "viewport",
          storagePathname: `${firstReservation.reservation.storagePathname}/losing-content-hash`,
        }
      )
    ).resolves.toEqual(finalized);
    expect(
      await browserImages.readReadyBrowserImageArtifact(alice, image.id, {
        rootSessionId: "session-alice",
      })
    ).toBeDefined();
    expect(
      await browserImages.readReadyBrowserImageArtifact(bob, image.id)
    ).toBeUndefined();
    expect(
      await browserImages.reserveBrowserImageArtifact(alice, imageInput)
    ).toEqual({ image, status: "ready" });
    await expect(
      browserImages.reserveBrowserImageArtifact(alice, {
        ...imageInput,
        workerSessionId: "different-worker",
      })
    ).rejects.toThrow("idempotency key is already in use");

    await sessions.claimSession(alice, "session-alice");

    expect(await sessions.isSessionOwned(alice, "session-alice")).toBe(true);
    expect(await sessions.isSessionOwned(bob, "session-alice")).toBe(false);

    await sessions.claimSession(alice, "session-imessage");
    const unindexedChats = (await chats.listChats(alice)).sort((left, right) =>
      left.sessionId.localeCompare(right.sessionId)
    );
    expect(
      unindexedChats.map(({ sessionId, title, usage }) => ({
        sessionId,
        title,
        usage,
      }))
    ).toEqual([
      {
        sessionId: "session-alice",
        title: "New chat",
        usage: { costUsd: null, inputTokens: 0, outputTokens: 0 },
      },
      {
        sessionId: "session-imessage",
        title: "New chat",
        usage: { costUsd: null, inputTokens: 0, outputTokens: 0 },
      },
    ]);
    expect(
      unindexedChats.every(
        (chat) => chat.createdAt.length > 0 && chat.updatedAt.length > 0
      )
    ).toBe(true);

    await sessions.claimSession(bob, "session-alice");
    expect(await sessions.isSessionOwned(alice, "session-alice")).toBe(true);
    expect(await sessions.isSessionOwned(bob, "session-alice")).toBe(false);

    await chats.saveChat(alice, {
      sessionId: "session-alice",
      title: "Initial title",
      usage: { costUsd: 0.25, inputTokens: 10, outputTokens: 4 },
    });
    await chats.saveChat(alice, {
      sessionId: "session-alice",
      title: "Updated title",
    });

    const aliceChat = await chats.readChat(alice, "session-alice");
    expect(aliceChat?.title).toBe("Updated title");
    expect(aliceChat?.usage).toEqual({
      costUsd: 0.25,
      inputTokens: 10,
      outputTokens: 4,
    });
    expect(await chats.readChat(bob, "session-alice")).toBeUndefined();
    const indexedChats = await chats.listChats(alice);
    expect(indexedChats).toHaveLength(2);
    expect(
      indexedChats.find((chat) => chat.sessionId === "session-alice")
    ).toEqual(aliceChat);
    expect(indexedChats.map((chat) => chat.sessionId)).toContain(
      "session-imessage"
    );
    expect(await chats.listChats(bob)).toEqual([]);

    await expect(
      chats.saveChat(bob, {
        sessionId: "session-alice",
        title: "Bob's title",
      })
    ).rejects.toThrow(/Failed query: insert into "chats"/);
    expect(await chats.readChat(alice, "session-alice")).toEqual(aliceChat);
    expect(await chats.readChat(bob, "session-alice")).toBeUndefined();

    await browsers.createBrowserSession(alice, {
      createdAt: new Date().toISOString(),
      sessionId: "browser-alice",
      workerSessionId: "worker-alice",
    });
    expect(
      await browsers.readBrowserSession(alice, "browser-alice")
    ).toMatchObject({ workerSessionId: "worker-alice" });
    expect(
      await browsers.readBrowserSession(bob, "browser-alice")
    ).toBeUndefined();
    expect(await browsers.listBrowserSessions(alice)).toHaveLength(1);
    expect(
      await browsers.listWorkerBrowserSessions(alice, "worker-alice")
    ).toHaveLength(1);
    expect(
      await browsers.listWorkerBrowserSessions(bob, "worker-alice")
    ).toEqual([]);
    expect(await browsers.deleteBrowserSession(bob, "browser-alice")).toBe(
      false
    );

    const { serializeLoginVaultPayload } = await import("@/lib/vault");
    await browserTraces.beginBrowserTrace(alice, {
      sessionId: "worker-alice",
      startedAt: "2026-08-31T00:00:00.000Z",
      task: "Order the blue mug",
    });
    await browserTraces.recordBrowserTraceDomains(alice, "worker-alice", [
      "shop.example.com",
      "shop.example.com",
    ]);
    await browserTraces.recordBrowserTraceDomains(bob, "worker-alice", [
      "intruder.example.com",
    ]);
    await browserTraces.completeBrowserTrace(alice, "worker-alice", {
      completedAt: "2026-08-31T00:00:12.500Z",
      resultMessage: "Ordered.",
      status: "success",
    });
    const [trace] = await pgliteDatabase
      .select()
      .from(browserTracesTable)
      .where(eq(browserTracesTable.sessionId, "worker-alice"));
    expect(trace).toMatchObject({
      durationMs: 12_500,
      resultMessage: "Ordered.",
      status: "success",
      task: "Order the blue mug",
    });
    const traceDomains = await pgliteDatabase
      .select()
      .from(browserTraceDomainsTable);
    expect(traceDomains).toHaveLength(1);
    expect(traceDomains[0]).toMatchObject({
      domain: "shop.example.com",
      traceSessionId: "worker-alice",
    });

    await browserTraces.recordBrowserTraceEvents(alice, "worker-alice", [
      {
        at: "2026-08-31T00:00:01.000Z",
        detail: "Order the blue mug",
        id: "evt_01",
        label: "Task received",
        type: "message.received",
      },
    ]);
    await browserTraces.recordBrowserTraceEvents(bob, "worker-alice", [
      {
        at: "2026-08-31T00:00:01.000Z",
        detail: "intrusion",
        id: "evt_02",
        label: "Task received",
        type: "message.received",
      },
    ]);
    const events = await browserTraces.listBrowserTraceEvents(
      alice,
      "worker-alice"
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: "evt_01", label: "Task received" });
    expect(
      await browserTraces.listBrowserTraceEvents(bob, "worker-alice")
    ).toEqual([]);

    const tracePage = await browserTraces.listBrowserTraces(alice);
    expect(tracePage.nextCursor).toBeNull();
    expect(tracePage.traces).toHaveLength(1);
    expect(tracePage.traces[0]).toMatchObject({
      domains: ["shop.example.com"],
      durationMs: 12_500,
      sessionId: "worker-alice",
      status: "success",
      task: "Order the blue mug",
    });
    expect((await browserTraces.listBrowserTraces(bob)).traces).toEqual([]);

    await vault.saveVaultItem(alice, {
      account: "alice@example.com",
      kind: "login",
      label: "Alice",
      secret: serializeLoginVaultPayload({
        authentication: { password: "correct horse", type: "password" },
        identifier: { type: "email", value: "alice@example.com" },
        kind: "login",
        origin: "https://example.com",
        version: 2,
      }),
    });
    const [aliceVaultItem] = await vault.listVaultItems(alice);
    expect(aliceVaultItem).toMatchObject({
      label: "Alice",
    });
    expect(
      await vault.readVaultItem(bob, aliceVaultItem?.id ?? "vault-alice")
    ).toBeUndefined();
    expect(await vault.listVaultItems(alice)).toHaveLength(1);
    expect(
      await vault.deleteVaultItem(bob, aliceVaultItem?.id ?? "vault-alice")
    ).toBe(false);

    await secrets.writeEncryptedSecret(alice, "shared-id", "ciphertext-alice");
    await secrets.writeEncryptedSecret(bob, "shared-id", "ciphertext-bob");
    expect(await secrets.readEncryptedSecret(alice, "shared-id")).toBe(
      "ciphertext-alice"
    );
    expect(await secrets.readEncryptedSecret(bob, "shared-id")).toBe(
      "ciphertext-bob"
    );
    await secrets.deleteEncryptedSecret(alice, "shared-id");
    expect(
      await secrets.readEncryptedSecret(alice, "shared-id")
    ).toBeUndefined();
    expect(await secrets.readEncryptedSecret(bob, "shared-id")).toBe(
      "ciphertext-bob"
    );

    await settings.selectGatewayModel(alice, "openai/test");
    expect(await settings.getGatewayModel(alice)).toBe("openai/test");
    expect(await settings.getGatewayModel(bob)).toBe("openai/gpt-5.6-sol-fast");
  }, 15_000);
});

async function applyInitialMigration(database: PGlite) {
  const migration = await readFile(
    new URL("../migrations/0000_fluffy_the_spike.sql", import.meta.url),
    "utf8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}

async function applyBrowserImageMigration(database: PGlite) {
  const migration = await readFile(
    new URL("../migrations/0003_unusual_fabian_cortez.sql", import.meta.url),
    "utf8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}

async function applyBrowserTraceMigration(database: PGlite) {
  const migration = await readFile(
    new URL("../migrations/0004_kind_manta.sql", import.meta.url),
    "utf8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}

async function applyBrowserTraceEventMigration(database: PGlite) {
  const migration = await readFile(
    new URL("../migrations/0005_brave_kang.sql", import.meta.url),
    "utf8"
  );
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await database.exec(statement);
  }
}
