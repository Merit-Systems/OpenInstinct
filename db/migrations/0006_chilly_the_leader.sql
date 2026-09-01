CREATE TABLE "automation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"revision" integer NOT NULL,
	"trigger_key" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"result" text,
	"error" text,
	"started_at" text NOT NULL,
	"completed_at" text,
	CONSTRAINT "automation_runs_status_check" CHECK ("automation_runs"."status" IN ('running', 'completed', 'failed', 'suppressed'))
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"title" text NOT NULL,
	"task" text NOT NULL,
	"trigger" text NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"next_run_at" text,
	"last_run_at" text,
	"idempotency_key" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "automations_status_check" CHECK ("automations"."status" IN ('active', 'paused', 'completed', 'deleted')),
	CONSTRAINT "automations_revision_check" CHECK ("automations"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "gmail_watches" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email_address" text,
	"history_id" text,
	"expiration_at" text,
	"generation" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'arming' NOT NULL,
	"workflow_run_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "gmail_watches_pkey" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "gmail_watches_status_check" CHECK ("gmail_watches"."status" IN ('arming', 'active', 'paused', 'failed')),
	CONSTRAINT "gmail_watches_generation_check" CHECK ("gmail_watches"."generation" > 0)
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_fkey" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_membership_fkey" FOREIGN KEY ("workspace_id","created_by_user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gmail_watches" ADD CONSTRAINT "gmail_watches_membership_fkey" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_runs_trigger_uidx" ON "automation_runs" USING btree ("automation_id","trigger_key");--> statement-breakpoint
CREATE INDEX "automation_runs_automation_started_idx" ON "automation_runs" USING btree ("automation_id","started_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "automations_workspace_idempotency_uidx" ON "automations" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "automations_workspace_status_idx" ON "automations" USING btree ("workspace_id","status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_watches_email_uidx" ON "gmail_watches" USING btree ("email_address");