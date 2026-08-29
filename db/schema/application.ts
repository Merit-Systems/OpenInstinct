import { sql } from "drizzle-orm";
import type { AgentManifest } from "@/lib/agent-manifest";
import { user } from "./auth";
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

export const phoneIdentityStatuses = [
  "verified",
  "revoked",
  "recycled",
] as const;
export type PhoneIdentityStatus = (typeof phoneIdentityStatuses)[number];

export const platformLineProviders = ["linq"] as const;
export type PlatformLineProvider = (typeof platformLineProviders)[number];

export const platformLineStatuses = ["active", "suspended", "retired"] as const;
export type PlatformLineStatus = (typeof platformLineStatuses)[number];

export const channelConversationStatuses = ["active", "closed"] as const;
export type ChannelConversationStatus =
  (typeof channelConversationStatuses)[number];

export const channelParticipantRoles = ["owner", "participant"] as const;
export type ChannelParticipantRole = (typeof channelParticipantRoles)[number];

export const channelParticipantStatuses = ["active", "revoked"] as const;
export type ChannelParticipantStatus =
  (typeof channelParticipantStatuses)[number];

export const connectionInstallationProviders = ["google", "linq"] as const;
export type ConnectionInstallationProvider =
  (typeof connectionInstallationProviders)[number];

export const connectionInstallationStatuses = ["active", "revoked"] as const;
export type ConnectionInstallationStatus =
  (typeof connectionInstallationStatuses)[number];

export const usageEventKinds = [
  "model_tokens",
  "browser_session",
  "provider_message",
  "storage_bytes",
] as const;
export type UsageEventKind = (typeof usageEventKinds)[number];

export const workspaceBudgetPeriods = ["monthly"] as const;
export type WorkspaceBudgetPeriod = (typeof workspaceBudgetPeriods)[number];

export const auditEventOutcomes = ["ok", "denied", "error"] as const;
export type AuditEventOutcome = (typeof auditEventOutcomes)[number];

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

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id"),
    kind: text("kind").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    costEstimateUsd: doublePrecision("cost_estimate_usd"),
    sessionId: text("session_id"),
    metadata: jsonb("metadata"),
    createdAt: text("created_at").notNull().default(utcTimestampDefault),
  },
  (table) => [
    foreignKey({
      name: "usage_events_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "usage_events_kind_check",
      sql`${table.kind} IN (${sqlValues(usageEventKinds)})`
    ),
    index("usage_events_workspace_kind_created_idx").on(
      table.workspaceId,
      table.kind,
      table.createdAt
    ),
  ]
);

export const workspaceBudgets = pgTable(
  "workspace_budgets",
  {
    workspaceId: text("workspace_id").primaryKey(),
    period: text("period").notNull().default("monthly"),
    modelTokenLimit: integer("model_token_limit"),
    browserSessionLimit: integer("browser_session_limit"),
    messageLimit: integer("message_limit"),
    updatedAt: text("updated_at").notNull().default(utcTimestampDefault),
  },
  (table) => [
    foreignKey({
      name: "workspace_budgets_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "workspace_budgets_period_check",
      sql`${table.period} IN (${sqlValues(workspaceBudgetPeriods)})`
    ),
  ]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    target: text("target"),
    outcome: text("outcome").notNull().default("ok"),
    correlationId: text("correlation_id"),
    metadata: jsonb("metadata"),
    createdAt: text("created_at").notNull().default(utcTimestampDefault),
  },
  (table) => [
    foreignKey({
      name: "audit_events_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "audit_events_outcome_check",
      sql`${table.outcome} IN (${sqlValues(auditEventOutcomes)})`
    ),
    index("audit_events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt
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

export const phoneIdentities = pgTable(
  "phone_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    encryptedPhoneNumber: text("encrypted_phone_number").notNull(),
    phoneLookupHash: text("phone_lookup_hash").notNull(),
    status: text("status").notNull().default("verified"),
    verifiedAt: text("verified_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull().default(utcTimestampDefault),
    updatedAt: text("updated_at").notNull().default(utcTimestampDefault),
  },
  (table) => [
    check(
      "phone_identities_status_check",
      sql`${table.status} IN (${sqlValues(phoneIdentityStatuses)})`
    ),
    foreignKey({
      name: "phone_identities_user_id_fkey",
      columns: [table.userId],
      foreignColumns: [user.id],
    }).onDelete("cascade"),
    uniqueIndex("phone_identities_verified_lookup_hash_uidx")
      .on(table.phoneLookupHash)
      .where(sql`${table.status} = 'verified'`),
    index("phone_identities_user_id_idx").on(table.userId),
  ]
);

export const connectionInstallations = pgTable(
  "connection_installations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider").notNull(),
    connectorId: text("connector_id").notNull(),
    authorizationSubject: text("authorization_subject").notNull(),
    scopes: jsonb("scopes").$type<readonly string[]>(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(utcTimestampDefault),
    updatedAt: text("updated_at").notNull().default(utcTimestampDefault),
    revokedAt: text("revoked_at"),
  },
  (table) => [
    foreignKey({
      name: "connection_installations_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "connection_installations_provider_check",
      sql`${table.provider} IN (${sqlValues(connectionInstallationProviders)})`
    ),
    check(
      "connection_installations_status_check",
      sql`${table.status} IN (${sqlValues(connectionInstallationStatuses)})`
    ),
    uniqueIndex("connection_installations_workspace_connector_subject_uidx").on(
      table.workspaceId,
      table.provider,
      table.connectorId,
      table.authorizationSubject
    ),
  ]
);

export const platformLines = pgTable(
  "platform_lines",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerLineId: text("provider_line_id").notNull(),
    connectorId: text("connector_id"),
    status: text("status").notNull().default("active"),
    environment: text("environment"),
    createdAt: text("created_at").notNull().default(utcTimestampDefault),
    updatedAt: text("updated_at").notNull().default(utcTimestampDefault),
  },
  (table) => [
    check(
      "platform_lines_provider_check",
      sql`${table.provider} IN (${sqlValues(platformLineProviders)})`
    ),
    check(
      "platform_lines_status_check",
      sql`${table.status} IN (${sqlValues(platformLineStatuses)})`
    ),
    uniqueIndex("platform_lines_provider_line_uidx").on(
      table.provider,
      table.providerLineId
    ),
  ]
);

export const channelConversations = pgTable(
  "channel_conversations",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    providerConversationId: text("provider_conversation_id").notNull(),
    platformLineId: text("platform_line_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    pinnedRevisionId: text("pinned_revision_id").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(utcTimestampDefault),
    updatedAt: text("updated_at").notNull().default(utcTimestampDefault),
  },
  (table) => [
    uniqueIndex("channel_conversations_provider_conversation_uidx").on(
      table.provider,
      table.providerAccountId,
      table.providerConversationId
    ),
    foreignKey({
      name: "channel_conversations_platform_line_id_fkey",
      columns: [table.platformLineId],
      foreignColumns: [platformLines.id],
    }),
    foreignKey({
      name: "channel_conversations_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "channel_conversations_workspace_agent_fkey",
      columns: [table.workspaceId, table.agentId],
      foreignColumns: [agents.workspaceId, agents.id],
    }),
    foreignKey({
      name: "channel_conversations_workspace_agent_revision_fkey",
      columns: [table.workspaceId, table.agentId, table.pinnedRevisionId],
      foreignColumns: [
        agentRevisions.workspaceId,
        agentRevisions.agentId,
        agentRevisions.id,
      ],
    }),
    check(
      "channel_conversations_status_check",
      sql`${table.status} IN (${sqlValues(channelConversationStatuses)})`
    ),
  ]
);

export const channelParticipants = pgTable(
  "channel_participants",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    phoneIdentityId: text("phone_identity_id").notNull(),
    role: text("role").notNull().default("owner"),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull().default(utcTimestampDefault),
  },
  (table) => [
    foreignKey({
      name: "channel_participants_conversation_id_fkey",
      columns: [table.conversationId],
      foreignColumns: [channelConversations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "channel_participants_phone_identity_id_fkey",
      columns: [table.phoneIdentityId],
      foreignColumns: [phoneIdentities.id],
    }),
    check(
      "channel_participants_role_check",
      sql`${table.role} IN (${sqlValues(channelParticipantRoles)})`
    ),
    check(
      "channel_participants_status_check",
      sql`${table.status} IN (${sqlValues(channelParticipantStatuses)})`
    ),
    uniqueIndex("channel_participants_conversation_identity_uidx").on(
      table.conversationId,
      table.phoneIdentityId
    ),
  ]
);
