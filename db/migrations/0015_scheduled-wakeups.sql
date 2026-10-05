CREATE TABLE "scheduled_wakeup_registrations" (
	"key" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"lease_expires_at" timestamp (3) with time zone NOT NULL,
	"workflow_run_id" text
);
--> statement-breakpoint
ALTER TABLE "scheduled_agent_jobs" ADD COLUMN "last_mutation_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD COLUMN "job_revision" integer;--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD COLUMN "wakeup_managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_agent_runs" ADD COLUMN "report_retry_at" timestamp (3) with time zone;
--> statement-breakpoint
UPDATE "scheduled_agent_runs" AS runs
SET "job_revision" = jobs."revision"
FROM "scheduled_agent_jobs" AS jobs
WHERE runs."job_id" = jobs."id";
