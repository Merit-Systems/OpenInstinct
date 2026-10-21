import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";
import type {
  MemoryProposal,
  MemoryRecordContent,
  memoryRecallSchema,
} from "@shared/memory/schema";
import { workspaces } from "./workspaces";
import { agentSessions } from "./sessions";

const partition = () => ({
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  scopeKey: text("scope_key").notNull(),
});
const at = (name: string) =>
  timestamp(name, { mode: "date", precision: 3, withTimezone: true });

export const memoryState = pgTable(
  "memory_state",
  {
    ...partition(),
    deletionEpoch: integer("deletion_epoch").notNull().default(0),
    generation: integer("generation").notNull().default(0),
    inputRevision: integer("input_revision").notNull().default(0),
    forgetBefore: at("forget_before"),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.scopeKey] })]
);

export const memoryBindings = pgTable(
  "memory_bindings",
  {
    ...partition(),
    sessionId: text("session_id")
      .primaryKey()
      .references(() => agentSessions.sessionId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    namespace: text("namespace").notNull(),
    cursor: integer("cursor").notNull().default(0),
    captureAfter: at("capture_after").notNull().defaultNow(),
    captureDisabled: boolean("capture_disabled").notNull().default(false),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("memory_bindings_scope_idx").on(table.workspaceId, table.scopeKey),
    check("memory_binding_cursor_check", sql`${table.cursor} >= 0`),
  ]
);

export const memorySources = pgTable(
  "memory_sources",
  {
    ...partition(),
    id: text("id").notNull(),
    kind: text("kind", {
      enum: [
        "user",
        "user_edit",
        "browser_receipt",
        "schedule_receipt",
        "legacy",
      ],
    }).notNull(),
    text: text("text"),
    reference: text("reference"),
    sessionId: text("session_id"),
    turnId: text("turn_id"),
    observedAt: at("observed_at").notNull(),
    version: integer("version").notNull().default(1),
    status: text("status", {
      enum: ["pending", "processed", "failed", "excluded", "forgotten"],
    })
      .notNull()
      .default("pending"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.scopeKey, table.id] }),
    index("memory_sources_pending_idx").on(
      table.workspaceId,
      table.scopeKey,
      table.status,
      table.createdAt
    ),
  ]
);

export const memoryRecords = pgTable(
  "memory_records",
  {
    ...partition(),
    id: text("id").notNull(),
    revision: integer("revision").notNull(),
    content: jsonb("content").$type<MemoryRecordContent>(),
    explicit: boolean("explicit").notNull().default(false),
    lastOperationId: text("last_operation_id").notNull(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.scopeKey, table.id] }),
    index("memory_records_recent_idx").on(
      table.workspaceId,
      table.scopeKey,
      table.updatedAt
    ),
    check("memory_record_revision_check", sql`${table.revision} > 0`),
  ]
);

export const memoryRevisions = pgTable(
  "memory_revisions",
  {
    ...partition(),
    recordId: text("record_id").notNull(),
    revision: integer("revision").notNull(),
    content: jsonb("content").$type<MemoryRecordContent>().notNull(),
    explicit: boolean("explicit").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.scopeKey,
        table.recordId,
        table.revision,
      ],
    }),
  ]
);

export const memoryLinks = pgTable(
  "memory_links",
  {
    ...partition(),
    fromId: text("from_id").notNull(),
    toId: text("to_id").notNull(),
    relation: text("relation").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.scopeKey,
        table.fromId,
        table.toId,
        table.relation,
      ],
    }),
  ]
);

export const memoryJobs = pgTable(
  "memory_jobs",
  {
    ...partition(),
    id: uuid("id").primaryKey().defaultRandom(),
    requestedByUserId: text("requested_by_user_id").notNull(),
    status: text("status", {
      enum: ["pending", "running", "completed", "cancelled", "dead_letter"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    epoch: integer("epoch").notNull(),
    publishedGeneration: integer("published_generation"),
    sourceVersions: jsonb("source_versions")
      .$type<readonly { id: string; version: number }[]>()
      .notNull()
      .default([]),
    checkpoint: jsonb("checkpoint").$type<MemoryProposal>(),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: at("lease_expires_at"),
    availableAt: at("available_at").notNull().defaultNow(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("memory_jobs_ready_idx").on(table.status, table.availableAt),
    index("memory_jobs_scope_idx").on(table.workspaceId, table.scopeKey),
  ]
);

export const memoryGenerations = pgTable(
  "memory_generations",
  {
    ...partition(),
    generation: integer("generation").notNull(),
    deletionEpoch: integer("deletion_epoch").notNull(),
    profile: text("profile").notNull(),
    currentContext: text("current_context").notNull(),
    recordIds: jsonb("record_ids").$type<string[]>().notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.scopeKey, table.generation],
    }),
  ]
);

export const memoryRecallResults = pgTable(
  "memory_recall_results",
  {
    ...partition(),
    operationId: text("operation_id").notNull(),
    deletionEpoch: integer("deletion_epoch").notNull(),
    result: jsonb("result").$type<z.infer<typeof memoryRecallSchema>>(),
    invalidated: boolean("invalidated").notNull().default(false),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.scopeKey, table.operationId],
    }),
  ]
);

export const memoryLegacyImports = pgTable(
  "memory_legacy_imports",
  {
    ...partition(),
    legacyScopeKey: text("legacy_scope_key").notNull(),
    importedAt: at("imported_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.legacyScopeKey] }),
  ]
);

export const memoryArtifacts = pgTable(
  "memory_artifacts",
  {
    workspaceId: text("workspace_id").notNull(),
    scopeKey: text("scope_key").notNull(),
    pathname: text("pathname").notNull(),
    jobId: uuid("job_id").notNull(),
    userId: text("user_id").notNull(),
    sha256: text("sha256").notNull(),
    recordId: text("record_id").notNull(),
    revision: integer("revision").notNull(),
    status: text("status", { enum: ["staged", "published", "purge"] })
      .notNull()
      .default("staged"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.scopeKey, table.pathname],
    }),
    index("memory_artifacts_cleanup_idx").on(table.status, table.createdAt),
  ]
);

export const memoryModelUsage = pgTable(
  "memory_model_usage",
  {
    ...partition(),
    jobId: uuid("job_id").notNull(),
    leaseToken: uuid("lease_token").notNull(),
    day: text("day").notNull(),
    modelId: text("model_id").notNull(),
    attempt: integer("attempt").notNull(),
    acceptedClaims: integer("accepted_claims"),
    responseModelId: text("response_model_id"),
    provider: text("provider"),
    status: text("status", { enum: ["reserved", "reported", "unknown"] })
      .notNull()
      .default("reserved"),
    outcome: text("outcome", { enum: ["succeeded", "failed"] }),
    reservedTokens: integer("reserved_tokens").notNull(),
    chargedTokens: integer("charged_tokens").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: at("created_at").notNull().defaultNow(),
    completedAt: at("completed_at"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.jobId, table.leaseToken] }),
    index("memory_model_usage_day_idx").on(table.workspaceId, table.day),
    check(
      "memory_usage_reservation_check",
      sql`${table.reservedTokens} > 0 AND ${table.chargedTokens} >= 0`
    ),
  ]
);
