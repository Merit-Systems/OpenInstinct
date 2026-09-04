-- This migration is idempotent. Its first revision shipped as 0011_big_shape
-- and was applied to a shared database before main's 0011_faulty_unicorn
-- existed. Because drizzle applies only migrations newer than the last applied
-- timestamp, such a database skipped 0011_faulty_unicorn, so the chats.channel
-- column is added here as well when it is missing.
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "channel" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proaction_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"proaction_id" text NOT NULL,
	"run_id" uuid,
	"fingerprint" text NOT NULL,
	"summary" text NOT NULL,
	"details" text,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"proposed_action" text,
	"action_status" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"delivered_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proaction_findings_urgency_check" CHECK ("proaction_findings"."urgency" IN ('normal', 'time_sensitive')),
	CONSTRAINT "proaction_findings_action_status_check" CHECK ("proaction_findings"."action_status" IN ('none', 'proposed', 'completed', 'failed')),
	CONSTRAINT "proaction_findings_status_check" CHECK ("proaction_findings"."status" IN ('new', 'delivered', 'acted', 'dismissed')),
	CONSTRAINT "proaction_findings_fingerprint_check" CHECK ("proaction_findings"."fingerprint" <> '')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proaction_policies" (
	"workspace_id" text NOT NULL,
	"proaction_id" text NOT NULL,
	"enabled" boolean,
	"autonomy" text,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proaction_policies_pkey" PRIMARY KEY("workspace_id","proaction_id"),
	CONSTRAINT "proaction_policies_autonomy_check" CHECK ("proaction_policies"."autonomy" IS NULL OR "proaction_policies"."autonomy" IN ('notify', 'propose', 'auto'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proaction_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"brief_local_time" text DEFAULT '08:00' NOT NULL,
	"linq_thread_id" text,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proaction_settings_brief_local_time_check" CHECK ("proaction_settings"."brief_local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
ALTER TABLE "scheduled_agent_jobs" ADD COLUMN IF NOT EXISTS "proaction_id" text;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.proaction_findings'::regclass AND conname = 'proaction_findings_run_id_scheduled_agent_runs_id_fk') THEN
		ALTER TABLE "proaction_findings" ADD CONSTRAINT "proaction_findings_run_id_scheduled_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."scheduled_agent_runs"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.proaction_findings'::regclass AND conname = 'proaction_findings_workspace_id_fkey') THEN
		ALTER TABLE "proaction_findings" ADD CONSTRAINT "proaction_findings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.proaction_policies'::regclass AND conname = 'proaction_policies_workspace_id_fkey') THEN
		ALTER TABLE "proaction_policies" ADD CONSTRAINT "proaction_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.proaction_settings'::regclass AND conname = 'proaction_settings_workspace_id_fkey') THEN
		ALTER TABLE "proaction_settings" ADD CONSTRAINT "proaction_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proaction_findings_fingerprint_idx" ON "proaction_findings" USING btree ("workspace_id","proaction_id","fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proaction_findings_workspace_idx" ON "proaction_findings" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proaction_findings_run_idx" ON "proaction_findings" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_agent_jobs_proaction_idx" ON "scheduled_agent_jobs" USING btree ("workspace_id","proaction_id") WHERE "scheduled_agent_jobs"."proaction_id" IS NOT NULL;