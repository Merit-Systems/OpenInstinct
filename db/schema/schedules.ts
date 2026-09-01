import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { workspaceMemberships } from "./workspaces";

export const scheduledAgentJobs = pgTable(
  "scheduled_agent_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    prompt: text("prompt").notNull(),
    linqThreadId: text("linq_thread_id").notNull(),
    timing: jsonb("timing").notNull(),
    missedRunPolicy: text("missed_run_policy").notNull().default("run_latest"),
    status: text("status").notNull().default("active"),
    nextRunAt: text("next_run_at"),
    lastRunAt: text("last_run_at"),
    lastError: text("last_error"),
    revision: integer("revision").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "scheduled_agent_jobs_membership_fkey",
      columns: [table.workspaceId, table.createdByUserId],
      foreignColumns: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }).onDelete("cascade"),
    check(
      "scheduled_agent_jobs_linq_thread_check",
      sql`${table.linqThreadId} LIKE 'linq:%'`
    ),
    check(
      "scheduled_agent_jobs_missed_run_policy_check",
      sql`${table.missedRunPolicy} IN ('skip', 'run_latest', 'catch_up')`
    ),
    check(
      "scheduled_agent_jobs_status_check",
      sql`${table.status} IN ('active', 'paused', 'completed', 'deleted')`
    ),
    index("scheduled_agent_jobs_due_idx").on(
      table.status,
      table.nextRunAt.asc().nullsLast()
    ),
    index("scheduled_agent_jobs_owner_idx").on(
      table.workspaceId,
      table.createdByUserId,
      table.nextRunAt.asc().nullsLast()
    ),
  ]
);

export const scheduledAgentRuns = pgTable(
  "scheduled_agent_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    scheduledFor: text("scheduled_for").notNull(),
    status: text("status").notNull().default("queued"),
    workerSessionId: text("worker_session_id"),
    outcome: jsonb("outcome"),
    reportStatus: text("report_status").notNull().default("not_ready"),
    attempts: integer("attempts").notNull().default(0),
    retryAt: text("retry_at"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: text("lease_expires_at"),
    lastError: text("last_error"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      name: "scheduled_agent_runs_job_id_fkey",
      columns: [table.jobId],
      foreignColumns: [scheduledAgentJobs.id],
    }).onDelete("cascade"),
    check(
      "scheduled_agent_runs_status_check",
      sql`${table.status} IN ('queued', 'running', 'completed', 'dead_letter')`
    ),
    check(
      "scheduled_agent_runs_report_status_check",
      sql`${table.reportStatus} IN ('not_ready', 'not_needed', 'pending', 'queued', 'delivered', 'suppressed')`
    ),
    uniqueIndex("scheduled_agent_runs_occurrence_idx").on(
      table.jobId,
      table.scheduledFor
    ),
    index("scheduled_agent_runs_ready_idx").on(
      table.status,
      table.retryAt.asc().nullsFirst()
    ),
    index("scheduled_agent_runs_report_idx").on(
      table.reportStatus,
      table.updatedAt.asc()
    ),
  ]
);

export const scheduledAgentJobsRelations = relations(
  scheduledAgentJobs,
  ({ many, one }) => ({
    membership: one(workspaceMemberships, {
      fields: [
        scheduledAgentJobs.workspaceId,
        scheduledAgentJobs.createdByUserId,
      ],
      references: [
        workspaceMemberships.workspaceId,
        workspaceMemberships.userId,
      ],
    }),
    runs: many(scheduledAgentRuns),
  })
);

export const scheduledAgentRunsRelations = relations(
  scheduledAgentRuns,
  ({ one }) => ({
    job: one(scheduledAgentJobs, {
      fields: [scheduledAgentRuns.jobId],
      references: [scheduledAgentJobs.id],
    }),
  })
);
