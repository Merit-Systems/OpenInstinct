import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { localAccessScope } from "../lib/access-scope";
import { createSqliteStore } from "../lib/server/app-store";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite app store", () => {
  it("persists the global chat index", async () => {
    const store = await createStore();
    await store.saveChat(localAccessScope, {
      sessionId: "session-1",
      title: "First request",
    });
    await store.saveChat(localAccessScope, {
      sessionId: "session-1",
      usage: { costUsd: 0.012, inputTokens: 1200, outputTokens: 300 },
    });

    expect(await store.listChats(localAccessScope)).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        title: "First request",
        usage: { costUsd: 0.012, inputTokens: 1200, outputTokens: 300 },
      }),
    ]);
  });

  it("keeps manager metadata behind the same store contract", async () => {
    const store = await createStore();
    const now = new Date().toISOString();
    const first = {
      account: "",
      createdAt: now,
      endpoint: "",
      id: "kernel-1",
      label: "Kernel",
      provider: "kernel" as const,
      updatedAt: now,
    };
    const second = { ...first, id: "kernel-2" };

    expect(await store.createConnection(localAccessScope, first, true)).toEqual(
      []
    );
    expect(
      await store.createConnection(localAccessScope, second, true)
    ).toEqual(["kernel-1"]);
    expect(await store.listConnections(localAccessScope)).toEqual([second]);

    await store.selectGatewayModel(localAccessScope, "openai/gpt-5.4");
    await store.selectBrowserMode(localAccessScope, "cloud");
    await expect(store.readBrowserMode(localAccessScope)).resolves.toBe(
      "cloud"
    );
    await expect(store.readModelStorage(localAccessScope)).resolves.toEqual({
      settings: {
        gateway_model: "openai/gpt-5.4",
        model_source: "gateway",
      },
    });
  });
});

async function createStore() {
  const directory = mkdtempSync(join(tmpdir(), "local-vault-store-"));
  temporaryDirectories.push(directory);
  const store = createSqliteStore(join(directory, "app.sqlite"));
  await store.initialize();
  return store;
}
