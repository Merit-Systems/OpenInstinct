import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { AccessScope } from "../lib/access-scope";
import { localAccessScope } from "../lib/access-scope";
import { createSqliteStore } from "../lib/server/app-store";

const directories: string[] = [];
const workspaceA = scope("user-a", "workspace-a");
const workspaceB = scope("user-b", "workspace-b");

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("workspace-scoped app store", () => {
  it("isolates connections, provider replacement, vault items, and deletes", async () => {
    const store = createStore();
    await store.initialize();
    await Promise.all([
      store.ensureScope(workspaceA),
      store.ensureScope(workspaceB),
    ]);
    const timestamp = new Date().toISOString();
    const connection = {
      account: "",
      createdAt: timestamp,
      endpoint: "",
      id: "connection-a",
      label: "A Kernel",
      provider: "kernel" as const,
      updatedAt: timestamp,
    };

    await store.createConnection(workspaceA, connection, true);
    await store.createConnection(
      workspaceB,
      { ...connection, id: "connection-b", label: "B Kernel" },
      true
    );
    expect(await store.listConnections(workspaceA)).toEqual([connection]);
    expect(await store.deleteConnection(workspaceA, "connection-b")).toBe(
      false
    );
    expect(await store.listConnections(workspaceB)).toHaveLength(1);

    await store.createConnection(
      workspaceA,
      { ...connection, id: "connection-a-2", label: "A Kernel 2" },
      true
    );
    expect(
      (await store.listConnections(workspaceA)).map((row) => row.id)
    ).toEqual(["connection-a-2"]);
    expect(
      (await store.listConnections(workspaceB)).map((row) => row.id)
    ).toEqual(["connection-b"]);

    await store.createVaultItem(workspaceA, {
      account: "person@example.com",
      createdAt: timestamp,
      id: "vault-a",
      kind: "login",
      label: "A login",
      updatedAt: timestamp,
    });
    expect(await store.listVaultItems(workspaceA)).toHaveLength(1);
    expect(await store.listVaultItems(workspaceB)).toEqual([]);
    expect(await store.deleteVaultItem(workspaceB, "vault-a")).toBe(false);
  });

  it("enforces durable session ownership", async () => {
    const store = createStore();
    await store.initialize();
    await store.claimSession(workspaceA, "session-a");

    await expect(store.isSessionOwned(workspaceA, "session-a")).resolves.toBe(
      true
    );
    await expect(store.isSessionOwned(workspaceB, "session-a")).resolves.toBe(
      false
    );
    await expect(store.listOwnedSessionIds(workspaceA)).resolves.toEqual(
      new Set(["session-a"])
    );
  });

  it("isolates model settings and encrypted secret rows", async () => {
    const store = createStore();
    await store.initialize();

    await store.selectGatewayModel(workspaceA, "openai/gpt-5.6");
    await store.writeEncryptedSecret(
      workspaceA,
      "connection",
      "shared-id",
      "ciphertext-a"
    );

    expect((await store.readModelStorage(workspaceA)).settings).toEqual({
      gateway_model: "openai/gpt-5.6",
      model_source: "gateway",
    });
    expect((await store.readModelStorage(workspaceB)).settings).toEqual({});
    await expect(
      store.readEncryptedSecret(workspaceB, "connection", "shared-id")
    ).resolves.toBeUndefined();

    await store.deleteEncryptedSecret(workspaceB, "connection", "shared-id");
    await expect(
      store.readEncryptedSecret(workspaceA, "connection", "shared-id")
    ).resolves.toBe("ciphertext-a");
  });

  it("isolates browser settings and chat history", async () => {
    const store = createStore();
    await store.initialize();

    await store.selectBrowserMode(workspaceA, "cloud");
    await store.saveChat(workspaceA, {
      sessionId: "session-a",
      title: "Workspace A chat",
    });

    await expect(store.readBrowserMode(workspaceA)).resolves.toBe("cloud");
    await expect(store.readBrowserMode(workspaceB)).resolves.toBeUndefined();
    await expect(store.listChats(workspaceA)).resolves.toHaveLength(1);
    await expect(store.listChats(workspaceB)).resolves.toEqual([]);
  });

  it("migrates existing local metadata without requiring sign-in", async () => {
    const directory = temporaryDirectory();
    const filename = join(directory, "manager.sqlite");
    const legacy = new DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE connections (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        label TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        account TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE vault_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        account TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO connections VALUES ('kernel-1', 'kernel', 'Kernel', '', '', 'now', 'now');
      INSERT INTO settings VALUES ('gateway_model', 'openai/gpt-5.6-sol-fast');
    `);
    legacy.close();

    const store = createSqliteStore(filename);
    await store.initialize();

    expect((await store.listConnections(localAccessScope))[0]?.id).toBe(
      "kernel-1"
    );
    expect((await store.readModelStorage(localAccessScope)).settings).toEqual({
      gateway_model: "openai/gpt-5.6-sol-fast",
    });
  });
});

function createStore() {
  return createSqliteStore(join(temporaryDirectory(), "manager.sqlite"));
}

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "eve-multi-user-"));
  directories.push(directory);
  return directory;
}

function scope(userId: string, workspaceId: string): AccessScope {
  return { mode: "hosted", userId, workspaceId };
}
