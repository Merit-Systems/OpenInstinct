import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sqliteConnections = sqliteTable("connections", {
  account: text("account").notNull(),
  createdAt: text("created_at").notNull(),
  endpoint: text("endpoint").notNull(),
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  provider: text("provider").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sqliteVaultItems = sqliteTable("vault_items", {
  account: text("account").notNull(),
  createdAt: text("created_at").notNull(),
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sqliteSettings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const sqliteChats = sqliteTable("chats", {
  costUsd: real("cost_usd"),
  createdAt: text("created_at").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  sessionId: text("session_id").primaryKey(),
  title: text("title").notNull(),
  updatedAt: text("updated_at").notNull(),
});
