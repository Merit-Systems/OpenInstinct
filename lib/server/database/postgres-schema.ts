import { doublePrecision, integer, pgTable, text } from "drizzle-orm/pg-core";

export const postgresConnections = pgTable("connections", {
  account: text("account").notNull(),
  createdAt: text("created_at").notNull(),
  endpoint: text("endpoint").notNull(),
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  provider: text("provider").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const postgresVaultItems = pgTable("vault_items", {
  account: text("account").notNull(),
  createdAt: text("created_at").notNull(),
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  label: text("label").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const postgresSettings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const postgresChats = pgTable("chats", {
  costUsd: doublePrecision("cost_usd"),
  createdAt: text("created_at").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  sessionId: text("session_id").primaryKey(),
  title: text("title").notNull(),
  updatedAt: text("updated_at").notNull(),
});
