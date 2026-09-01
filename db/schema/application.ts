import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
});

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId],
      name: "workspace_memberships_pkey",
    }),
    foreignKey({
      name: "workspace_memberships_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("workspace_memberships_role_check", sql`${table.role} = 'owner'`),
  ]
);

export const vaultItems = pgTable(
  "vault_items",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    account: text("account").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "vault_items_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "vault_items_kind_check",
      sql`${table.kind} IN ('login', 'payment', 'address', 'contact', 'phone', 'identity', 'token')`
    ),
    index("vault_items_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt.desc().nullsFirst()
    ),
  ]
);

export const settings = pgTable(
  "settings",
  {
    workspaceId: text("workspace_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.key],
      name: "settings_pkey",
    }),
    foreignKey({
      name: "settings_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("settings_key_check", sql`${table.key} = 'gateway_model'`),
  ]
);

export const agentSessions = pgTable(
  "agent_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "agent_sessions_membership_fkey",
      columns: [table.workspaceId, table.createdByUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("agent_sessions_workspace_idx").on(
      table.workspaceId,
      table.createdAt.desc().nullsFirst()
    ),
  ]
);

export const browserSessions = pgTable(
  "browser_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
    workerSessionId: text("worker_session_id"),
  },
  (table) => [
    foreignKey({
      name: "browser_sessions_membership_fkey",
      columns: [table.workspaceId, table.createdByUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    index("browser_sessions_workspace_idx").on(
      table.workspaceId,
      table.createdAt.desc().nullsFirst()
    ),
    index("browser_sessions_worker_idx").on(
      table.workspaceId,
      table.workerSessionId
    ),
  ]
);

export const browserTraces = pgTable(
  "browser_traces",
  {
    sessionId: text("session_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    task: text("task").notNull(),
    status: text("status").notNull(),
    resultMessage: text("result_message"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    durationMs: integer("duration_ms"),
  },
  (table) => [
    foreignKey({
      name: "browser_traces_membership_fkey",
      columns: [table.workspaceId, table.createdByUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    check(
      "browser_traces_status_check",
      sql`${table.status} IN ('running', 'success', 'failure', 'error', 'cancelled')`
    ),
    check(
      "browser_traces_duration_ms_check",
      sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`
    ),
    index("browser_traces_workspace_started_idx").on(
      table.workspaceId,
      table.startedAt.desc().nullsFirst()
    ),
  ]
);

export const browserTraceEvents = pgTable(
  "browser_trace_events",
  {
    id: text("id").primaryKey(),
    traceSessionId: text("trace_session_id").notNull(),
    at: text("at").notNull(),
    type: text("type").notNull(),
    label: text("label").notNull(),
    detail: text("detail").notNull(),
  },
  (table) => [
    foreignKey({
      name: "browser_trace_events_trace_fkey",
      columns: [table.traceSessionId],
      foreignColumns: [browserTraces.sessionId],
    }).onDelete("cascade"),
    index("browser_trace_events_trace_idx").on(table.traceSessionId, table.id),
  ]
);

export const browserTraceDomains = pgTable(
  "browser_trace_domains",
  {
    traceSessionId: text("trace_session_id").notNull(),
    domain: text("domain").notNull(),
    firstSeenAt: text("first_seen_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.traceSessionId, table.domain],
      name: "browser_trace_domains_pkey",
    }),
    foreignKey({
      name: "browser_trace_domains_trace_fkey",
      columns: [table.traceSessionId],
      foreignColumns: [browserTraces.sessionId],
    }).onDelete("cascade"),
    index("browser_trace_domains_domain_idx").on(table.domain),
  ]
);

export const browserImageArtifacts = pgTable(
  "browser_image_artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    rootSessionId: text("root_session_id").notNull(),
    workerSessionId: text("worker_session_id").notNull(),
    browserSessionId: text("browser_session_id").notNull(),
    status: text("status").notNull(),
    label: text("label").notNull(),
    filename: text("filename"),
    mediaType: text("media_type"),
    byteSize: integer("byte_size"),
    contentHash: text("content_hash"),
    storagePathname: text("storage_pathname").notNull(),
    sourceKind: text("source_kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "browser_image_artifacts_membership_fkey",
      columns: [table.workspaceId, table.createdByUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    check(
      "browser_image_artifacts_status_check",
      sql`${table.status} IN ('pending', 'ready')`
    ),
    check(
      "browser_image_artifacts_source_kind_check",
      sql`${table.sourceKind} IN ('element', 'full_page', 'image_resource', 'viewport')`
    ),
    check(
      "browser_image_artifacts_ready_fields_check",
      sql`${table.status} = 'pending' OR (${table.filename} IS NOT NULL AND ${table.mediaType} IS NOT NULL AND ${table.byteSize} > 0 AND ${table.contentHash} IS NOT NULL)`
    ),
    uniqueIndex("browser_image_artifacts_workspace_idempotency_uidx").on(
      table.workspaceId,
      table.idempotencyKey
    ),
    index("browser_image_artifacts_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt.desc().nullsFirst()
    ),
  ]
);

export const chats = pgTable(
  "chats",
  {
    sessionId: text("session_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    title: text("title").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd"),
  },
  (table) => [
    foreignKey({
      name: "chats_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check("chats_input_tokens_check", sql`${table.inputTokens} >= 0`),
    check("chats_output_tokens_check", sql`${table.outputTokens} >= 0`),
    check(
      "chats_cost_usd_check",
      sql`${table.costUsd} IS NULL OR ${table.costUsd} >= 0`
    ),
    index("chats_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt.desc().nullsFirst()
    ),
  ]
);

export const encryptedSecrets = pgTable(
  "encrypted_secrets",
  {
    workspaceId: text("workspace_id").notNull(),
    namespace: text("namespace").notNull(),
    id: text("id").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.namespace, table.id],
      name: "encrypted_secrets_pkey",
    }),
    foreignKey({
      name: "encrypted_secrets_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "encrypted_secrets_namespace_check",
      sql`${table.namespace} = 'vault'`
    ),
  ]
);

export const automations = pgTable(
  "automations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    sessionId: text("session_id").notNull(),
    phoneNumber: text("phone_number").notNull(),
    title: text("title").notNull(),
    task: text("task").notNull(),
    trigger: text("trigger").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull().default("active"),
    revision: integer("revision").notNull().default(1),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "automations_membership_fkey",
      columns: [table.workspaceId, table.createdByUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "automations_session_id_fkey",
      columns: [table.sessionId],
      foreignColumns: [agentSessions.sessionId],
    }).onDelete("cascade"),
    check(
      "automations_status_check",
      sql`${table.status} IN ('active', 'paused', 'completed', 'deleted')`
    ),
    check("automations_revision_check", sql`${table.revision} > 0`),
    uniqueIndex("automations_workspace_idempotency_uidx").on(
      table.workspaceId,
      table.idempotencyKey
    ),
    index("automations_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.nextRunAt
    ),
  ]
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id").notNull(),
    revision: integer("revision").notNull(),
    triggerKey: text("trigger_key").notNull(),
    status: text("status").notNull().default("running"),
    eveSessionId: text("eve_session_id"),
    result: text("result"),
    error: text("error"),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    foreignKey({
      name: "automation_runs_automation_id_fkey",
      columns: [table.automationId],
      foreignColumns: [automations.id],
    }).onDelete("cascade"),
    check(
      "automation_runs_status_check",
      sql`${table.status} IN ('running', 'completed', 'failed', 'suppressed')`
    ),
    uniqueIndex("automation_runs_trigger_uidx").on(
      table.automationId,
      table.triggerKey
    ),
    index("automation_runs_automation_started_idx").on(
      table.automationId,
      table.startedAt.desc().nullsFirst()
    ),
  ]
);

export const gmailWatches = pgTable(
  "gmail_watches",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    emailAddress: text("email_address"),
    historyId: text("history_id"),
    expirationAt: text("expiration_at"),
    generation: integer("generation").notNull().default(1),
    status: text("status").notNull().default("arming"),
    workflowRunId: text("workflow_run_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId],
      name: "gmail_watches_pkey",
    }),
    foreignKey({
      name: "gmail_watches_membership_fkey",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    check(
      "gmail_watches_status_check",
      sql`${table.status} IN ('arming', 'active', 'paused', 'failed')`
    ),
    check("gmail_watches_generation_check", sql`${table.generation} > 0`),
    uniqueIndex("gmail_watches_email_uidx").on(table.emailAddress),
  ]
);
