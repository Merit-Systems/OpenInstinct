import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { chatListSchema, type SaveChat } from "../../chat";
import { browserModeSchema } from "../../manager";
import {
  connectionRecordSchema,
  modelStorageSchema,
  vaultRecordSchema,
} from "./records";
import {
  postgresChats,
  postgresConnections,
  postgresSettings,
  postgresVaultItems,
} from "./postgres-schema";
import type { AppStore } from "./store";

const schema = {
  chats: postgresChats,
  connections: postgresConnections,
  settings: postgresSettings,
  vaultItems: postgresVaultItems,
};

export function createNeonStore(databaseUrl: string): AppStore {
  const database = drizzle(databaseUrl, { schema });

  return {
    async createConnection(record, replaceProvider) {
      const replaced = replaceProvider
        ? await database
            .select({ id: postgresConnections.id })
            .from(postgresConnections)
            .where(eq(postgresConnections.provider, record.provider))
        : [];
      const insertConnection = database
        .insert(postgresConnections)
        .values(record);

      if (replaceProvider) {
        await database.batch([
          insertConnection,
          database
            .delete(postgresConnections)
            .where(
              and(
                eq(postgresConnections.provider, record.provider),
                ne(postgresConnections.id, record.id)
              )
            ),
        ]);
      } else {
        await insertConnection;
      }
      return replaced.map((row) => row.id);
    },
    async createVaultItem(record) {
      await database.insert(postgresVaultItems).values(record);
    },
    async deleteConnection(id) {
      await database
        .delete(postgresConnections)
        .where(eq(postgresConnections.id, id));
    },
    async deleteVaultItem(id) {
      await database
        .delete(postgresVaultItems)
        .where(eq(postgresVaultItems.id, id));
    },
    async initialize() {
      await database.execute(sql`
        CREATE TABLE IF NOT EXISTS connections (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          label TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          account TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await database.execute(sql`
        CREATE TABLE IF NOT EXISTS vault_items (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          label TEXT NOT NULL,
          account TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      await database.execute(sql`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      await database.execute(sql`
        CREATE TABLE IF NOT EXISTS chats (
          session_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd DOUBLE PRECISION
        )
      `);
      await database.execute(sql`
        CREATE INDEX IF NOT EXISTS chats_updated_at_idx ON chats (updated_at DESC)
      `);
      await database.execute(sql`
        ALTER TABLE chats ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0
      `);
      await database.execute(sql`
        ALTER TABLE chats ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0
      `);
      await database.execute(sql`
        ALTER TABLE chats ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION
      `);
    },
    async listChats() {
      const chats = await database
        .select()
        .from(postgresChats)
        .orderBy(desc(postgresChats.updatedAt));
      return chatListSchema.parse(
        chats.map(({ costUsd, inputTokens, outputTokens, ...chat }) => ({
          ...chat,
          usage: { costUsd, inputTokens, outputTokens },
        }))
      );
    },
    async listConnections() {
      return connectionRecordSchema
        .array()
        .parse(
          await database
            .select()
            .from(postgresConnections)
            .orderBy(desc(postgresConnections.updatedAt))
        );
    },
    async listVaultItems() {
      return vaultRecordSchema
        .array()
        .parse(
          await database
            .select()
            .from(postgresVaultItems)
            .orderBy(desc(postgresVaultItems.updatedAt))
        );
    },
    async readConnectionByProvider(provider) {
      return connectionRecordSchema.optional().parse(
        await database
          .select()
          .from(postgresConnections)
          .where(eq(postgresConnections.provider, provider))
          .orderBy(desc(postgresConnections.updatedAt))
          .limit(1)
          .then((rows) => rows[0])
      );
    },
    async readBrowserMode() {
      const row = await database
        .select({ value: postgresSettings.value })
        .from(postgresSettings)
        .where(eq(postgresSettings.key, "browser_mode"))
        .limit(1)
        .then((rows) => rows[0]);
      return row ? browserModeSchema.parse(row.value) : undefined;
    },
    async readModelStorage() {
      const [settingRows, localModels] = await Promise.all([
        database
          .select()
          .from(postgresSettings)
          .where(
            inArray(postgresSettings.key, ["gateway_model", "model_source"])
          ),
        database
          .select()
          .from(postgresConnections)
          .where(
            and(
              eq(postgresConnections.provider, "local-model"),
              ne(postgresConnections.endpoint, "")
            )
          )
          .orderBy(desc(postgresConnections.updatedAt))
          .limit(1),
      ]);

      return modelStorageSchema.parse({
        localModel: localModels[0],
        settings: Object.fromEntries(
          settingRows.map((row) => [row.key, row.value])
        ),
      });
    },
    async saveChat(chat: SaveChat) {
      const now = new Date().toISOString();
      const update: Partial<typeof postgresChats.$inferInsert> = {
        updatedAt: now,
      };
      if (chat.title !== undefined) update.title = chat.title;
      if (chat.usage !== undefined) {
        update.costUsd = chat.usage.costUsd;
        update.inputTokens = chat.usage.inputTokens;
        update.outputTokens = chat.usage.outputTokens;
      }
      await database
        .insert(postgresChats)
        .values({
          costUsd: chat.usage?.costUsd ?? null,
          createdAt: now,
          inputTokens: chat.usage?.inputTokens ?? 0,
          outputTokens: chat.usage?.outputTokens ?? 0,
          sessionId: chat.sessionId,
          title: chat.title ?? "New chat",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: update,
          target: postgresChats.sessionId,
        });
    },
    async selectGatewayModel(modelId) {
      await database.batch([
        database
          .insert(postgresSettings)
          .values({ key: "gateway_model", value: modelId })
          .onConflictDoUpdate({
            set: { value: modelId },
            target: postgresSettings.key,
          }),
        database
          .insert(postgresSettings)
          .values({ key: "model_source", value: "gateway" })
          .onConflictDoUpdate({
            set: { value: "gateway" },
            target: postgresSettings.key,
          }),
      ]);
    },
    async selectBrowserMode(mode) {
      await database
        .insert(postgresSettings)
        .values({ key: "browser_mode", value: mode })
        .onConflictDoUpdate({
          set: { value: mode },
          target: postgresSettings.key,
        });
    },
    async selectLocalModel() {
      await database
        .insert(postgresSettings)
        .values({ key: "model_source", value: "local" })
        .onConflictDoUpdate({
          set: { value: "local" },
          target: postgresSettings.key,
        });
    },
  };
}
