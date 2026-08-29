import { sql } from "drizzle-orm";
import type { AgentManifest } from "@/lib/agent-manifest";
import {
  check,
  type AnyPgColumn,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const workspaceMembershipRoles = ["owner", "admin", "member"] as const;
export type WorkspaceMembershipRole = (typeof workspaceMembershipRoles)[number];

export const workspaceMembershipStatuses = [
  "active",
  "invited",
  "revoked",
] as const;
export type WorkspaceMembershipStatus =
  (typeof workspaceMembershipStatuses)[number];

export const workspaceLifecycleStates = [
  "trial",
  "active",
  "suspended",
  "pending_deletion",
  "deleted",
] as const;
export type WorkspaceLifecycleState = (typeof workspaceLifecycleStates)[number];

const utcTimestampDefault = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

function sqlValues(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name"),
    plan: text("plan").notNull().default("free"),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    policyVersion: integer("policy_version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull().default(utcTimestampDefault),
  },
  (table) => [
    check(
      "workspaces_lifecycle_state_check",
      sql`${table.lifecycleState} IN (${sqlValues(workspaceLifecycleStates)})`
    ),
  ]
);

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    invitedByUserId: text("invited_by_user_id"),
    invitedAt: text("invited_at"),
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
    check(
      "workspace_memberships_role_check",
      sql`${table.role} IN (${sqlValues(workspaceMembershipRoles)})`
    ),
    check(
      "workspace_memberships_status_check",
      sql`${table.status} IN (${sqlValues(workspaceMembershipStatuses)})`
    ),
  ]
);

export const agentStatuses = ["draft", "active", "archived"] as const;
export type AgentStatus = (typeof agentStatuses)[number];

function activeRevisionForeignColumns(): [
  AnyPgColumn,
  AnyPgColumn,
  AnyPgColumn,
] {
  return [
    agentRevisions.workspaceId,
    agentRevisions.agentId,
    agentRevisions.id,
  ];
}

export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    displayName: text("display_name"),
    status: text("status").notNull().default("draft"),
    activeRevisionId: text("active_revision_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull().default(utcTimestampDefault),
  },
  (table) => [
    foreignKey({
      name: "agents_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "agents_status_check",
      sql`${table.status} IN (${sqlValues(agentStatuses)})`
    ),
    uniqueIndex("agents_workspace_id_uidx").on(table.workspaceId, table.id),
    uniqueIndex("agents_workspace_slug_uidx").on(table.workspaceId, table.slug),
    foreignKey({
      name: "agents_workspace_active_revision_fkey",
      columns: [table.workspaceId, table.id, table.activeRevisionId],
      foreignColumns: activeRevisionForeignColumns(),
    }),
  ]
);

export const agentRevisions = pgTable(
  "agent_revisions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    manifest: jsonb("manifest").$type<AgentManifest>().notNull(),
    contentDigest: text("content_digest").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "agent_revisions_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "agent_revisions_workspace_agent_fkey",
      columns: [table.workspaceId, table.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
    }).onDelete("cascade"),
    uniqueIndex("agent_revisions_workspace_id_uidx").on(
      table.workspaceId,
      table.id
    ),
    uniqueIndex("agent_revisions_agent_revision_number_uidx").on(
      table.agentId,
      table.revisionNumber
    ),
    uniqueIndex("agent_revisions_workspace_agent_id_uidx").on(
      table.workspaceId,
      table.agentId,
      table.id
    ),
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
