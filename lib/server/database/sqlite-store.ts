import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { z } from "zod";
import { chatListSchema, type SaveChat } from "../../chat";
import { browserModeSchema } from "../../manager";
import {
  connectionRecordSchema,
  modelStorageSchema,
  vaultRecordSchema,
} from "./records";
import {
  sqliteChats,
  sqliteConnections,
  sqliteSettings,
  sqliteVaultItems,
} from "./sqlite-schema";
import type { AppStore } from "./store";

const schema = {
  chats: sqliteChats,
  connections: sqliteConnections,
  settings: sqliteSettings,
  vaultItems: sqliteVaultItems,
};

const sqliteColumnListSchema = z.looseObject({ name: z.string() }).array();
const sqliteParameterListSchema = z
  .union([
    z.null(),
    z.string(),
    z.number(),
    z.bigint(),
    z.custom<NodeJS.ArrayBufferView>((value) => ArrayBuffer.isView(value)),
  ])
  .array();
const sqliteRowSchema = z.array(z.unknown());
const sqliteRowsSchema = sqliteRowSchema.array();

export function createSqliteStore(filename: string): AppStore {
  mkdirSync(dirname(filename), { mode: 0o700, recursive: true });
  const client = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  const database = drizzle(
    async (
      query: string,
      rawParameters: unknown[],
      method: "all" | "get" | "run" | "values"
    ) => {
      const statement = client.prepare(query);
      const parameters = normalizeSqliteParameters(rawParameters);

      if (method === "run") {
        statement.run(...parameters);
        return { rows: [] };
      }

      statement.setReturnArrays(true);
      if (method === "get") {
        const row = statement.get(...parameters);
        return {
          rows: row === undefined ? [] : sqliteRowSchema.parse(row),
        };
      }

      return {
        rows: sqliteRowsSchema.parse(statement.all(...parameters)),
      };
    },
    { schema }
  );

  return {
    async createConnection(record, replaceProvider) {
      const replaced = replaceProvider
        ? await database
            .select({ id: sqliteConnections.id })
            .from(sqliteConnections)
            .where(eq(sqliteConnections.provider, record.provider))
        : [];

      await database.transaction(async (transaction) => {
        await transaction.insert(sqliteConnections).values(record);
        if (replaceProvider) {
          await transaction
            .delete(sqliteConnections)
            .where(
              and(
                eq(sqliteConnections.provider, record.provider),
                ne(sqliteConnections.id, record.id)
              )
            );
        }
      });
      return replaced.map((row) => row.id);
    },
    async createVaultItem(record) {
      await database.insert(sqliteVaultItems).values(record);
    },
    async deleteConnection(id) {
      await database
        .delete(sqliteConnections)
        .where(eq(sqliteConnections.id, id));
    },
    async deleteVaultItem(id) {
      await database
        .delete(sqliteVaultItems)
        .where(eq(sqliteVaultItems.id, id));
    },
    async initialize() {
      client.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS connections (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          label TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          account TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vault_items (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          label TEXT NOT NULL,
          account TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chats (
          session_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          cost_usd REAL
        );
        CREATE INDEX IF NOT EXISTS chats_updated_at_idx ON chats (updated_at DESC);
      `);
      const chatColumns = new Set(
        sqliteColumnListSchema
          .parse(client.prepare("PRAGMA table_info(chats)").all())
          .map((column) => column.name)
      );
      if (!chatColumns.has("input_tokens")) {
        client.exec(
          "ALTER TABLE chats ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0"
        );
      }
      if (!chatColumns.has("output_tokens")) {
        client.exec(
          "ALTER TABLE chats ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0"
        );
      }
      if (!chatColumns.has("cost_usd")) {
        client.exec("ALTER TABLE chats ADD COLUMN cost_usd REAL");
      }
    },
    async listChats() {
      const chats = await database
        .select()
        .from(sqliteChats)
        .orderBy(desc(sqliteChats.updatedAt));
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
            .from(sqliteConnections)
            .orderBy(desc(sqliteConnections.updatedAt))
        );
    },
    async listVaultItems() {
      return vaultRecordSchema
        .array()
        .parse(
          await database
            .select()
            .from(sqliteVaultItems)
            .orderBy(desc(sqliteVaultItems.updatedAt))
        );
    },
    async readConnectionByProvider(provider) {
      return connectionRecordSchema.optional().parse(
        await database
          .select()
          .from(sqliteConnections)
          .where(eq(sqliteConnections.provider, provider))
          .orderBy(desc(sqliteConnections.updatedAt))
          .limit(1)
          .then((rows) => rows[0])
      );
    },
    async readBrowserMode() {
      const row = await database
        .select({ value: sqliteSettings.value })
        .from(sqliteSettings)
        .where(eq(sqliteSettings.key, "browser_mode"))
        .limit(1)
        .then((rows) => rows[0]);
      return row ? browserModeSchema.parse(row.value) : undefined;
    },
    async readModelStorage() {
      const [settingRows, localModels] = await Promise.all([
        database
          .select()
          .from(sqliteSettings)
          .where(
            inArray(sqliteSettings.key, ["gateway_model", "model_source"])
          ),
        database
          .select()
          .from(sqliteConnections)
          .where(
            and(
              eq(sqliteConnections.provider, "local-model"),
              ne(sqliteConnections.endpoint, "")
            )
          )
          .orderBy(desc(sqliteConnections.updatedAt))
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
      const update: Partial<typeof sqliteChats.$inferInsert> = {
        updatedAt: now,
      };
      if (chat.title !== undefined) update.title = chat.title;
      if (chat.usage !== undefined) {
        update.costUsd = chat.usage.costUsd;
        update.inputTokens = chat.usage.inputTokens;
        update.outputTokens = chat.usage.outputTokens;
      }
      await database
        .insert(sqliteChats)
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
          target: sqliteChats.sessionId,
        });
    },
    async selectGatewayModel(modelId) {
      await database.transaction(async (transaction) => {
        await transaction
          .insert(sqliteSettings)
          .values({ key: "gateway_model", value: modelId })
          .onConflictDoUpdate({
            set: { value: modelId },
            target: sqliteSettings.key,
          });
        await transaction
          .insert(sqliteSettings)
          .values({ key: "model_source", value: "gateway" })
          .onConflictDoUpdate({
            set: { value: "gateway" },
            target: sqliteSettings.key,
          });
      });
    },
    async selectBrowserMode(mode) {
      await database
        .insert(sqliteSettings)
        .values({ key: "browser_mode", value: mode })
        .onConflictDoUpdate({
          set: { value: mode },
          target: sqliteSettings.key,
        });
    },
    async selectLocalModel() {
      await database
        .insert(sqliteSettings)
        .values({ key: "model_source", value: "local" })
        .onConflictDoUpdate({
          set: { value: "local" },
          target: sqliteSettings.key,
        });
    },
  };
}

function normalizeSqliteParameters(
  parameters: readonly unknown[]
): SQLInputValue[] {
  return sqliteParameterListSchema.parse(parameters);
}
