import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { scheduledAgentRuns } from "./schedules";
import { workspaces } from "./workspaces";

const timestampColumn = (name: string) =>
  timestamp(name, { mode: "date", precision: 3, withTimezone: true });

export const proactionPolicies = pgTable(
  "proaction_policies",
  {
    workspaceId: text("workspace_id").notNull(),
    proactionId: text("proaction_id").notNull(),
    enabled: boolean("enabled"),
    autonomy: text("autonomy", { enum: ["notify", "propose", "auto"] }),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.proactionId],
      name: "proaction_policies_pkey",
    }),
    foreignKey({
      name: "proaction_policies_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "proaction_policies_autonomy_check",
      sql`${table.autonomy} IS NULL OR ${table.autonomy} IN ('notify', 'propose', 'auto')`
    ),
  ]
);

export const proactionSettings = pgTable(
  "proaction_settings",
  {
    workspaceId: text("workspace_id").primaryKey(),
    timezone: text("timezone").notNull().default("UTC"),
    briefLocalTime: text("brief_local_time").notNull().default("08:00"),
    linqThreadId: text("linq_thread_id"),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "proaction_settings_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "proaction_settings_brief_local_time_check",
      sql`${table.briefLocalTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`
    ),
  ]
);

export const proactionFindings = pgTable(
  "proaction_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    proactionId: text("proaction_id").notNull(),
    runId: uuid("run_id").references(() => scheduledAgentRuns.id, {
      onDelete: "set null",
    }),
    fingerprint: text("fingerprint").notNull(),
    summary: text("summary").notNull(),
    details: text("details"),
    urgency: text("urgency", { enum: ["normal", "time_sensitive"] })
      .notNull()
      .default("normal"),
    proposedAction: text("proposed_action"),
    actionStatus: text("action_status", {
      enum: ["none", "proposed", "completed", "failed"],
    })
      .notNull()
      .default("none"),
    status: text("status", {
      enum: ["new", "delivered", "acted", "dismissed"],
    })
      .notNull()
      .default("new"),
    deliveredAt: timestampColumn("delivered_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "proaction_findings_workspace_id_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    check(
      "proaction_findings_urgency_check",
      sql`${table.urgency} IN ('normal', 'time_sensitive')`
    ),
    check(
      "proaction_findings_action_status_check",
      sql`${table.actionStatus} IN ('none', 'proposed', 'completed', 'failed')`
    ),
    check(
      "proaction_findings_status_check",
      sql`${table.status} IN ('new', 'delivered', 'acted', 'dismissed')`
    ),
    check(
      "proaction_findings_fingerprint_check",
      sql`${table.fingerprint} <> ''`
    ),
    uniqueIndex("proaction_findings_fingerprint_idx").on(
      table.workspaceId,
      table.proactionId,
      table.fingerprint
    ),
    index("proaction_findings_workspace_idx").on(
      table.workspaceId,
      table.createdAt.desc()
    ),
    index("proaction_findings_run_idx").on(table.runId),
  ]
);

export const proactionPoliciesRelations = relations(
  proactionPolicies,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [proactionPolicies.workspaceId],
      references: [workspaces.id],
    }),
  })
);

export const proactionSettingsRelations = relations(
  proactionSettings,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [proactionSettings.workspaceId],
      references: [workspaces.id],
    }),
  })
);

export const proactionFindingsRelations = relations(
  proactionFindings,
  ({ one }) => ({
    run: one(scheduledAgentRuns, {
      fields: [proactionFindings.runId],
      references: [scheduledAgentRuns.id],
    }),
    workspace: one(workspaces, {
      fields: [proactionFindings.workspaceId],
      references: [workspaces.id],
    }),
  })
);
