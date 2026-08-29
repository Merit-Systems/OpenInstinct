CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target" text,
	"outcome" text DEFAULT 'ok' NOT NULL,
	"correlation_id" text,
	"metadata" jsonb,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "audit_events_outcome_check" CHECK ("audit_events"."outcome" IN ('ok', 'denied', 'error'))
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"cost_estimate_usd" double precision,
	"session_id" text,
	"metadata" jsonb,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "usage_events_kind_check" CHECK ("usage_events"."kind" IN ('model_tokens', 'browser_session', 'provider_message', 'storage_bytes'))
);
--> statement-breakpoint
CREATE TABLE "workspace_budgets" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"period" text DEFAULT 'monthly' NOT NULL,
	"model_token_limit" integer,
	"browser_session_limit" integer,
	"message_limit" integer,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "workspace_budgets_period_check" CHECK ("workspace_budgets"."period" IN ('monthly'))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_budgets" ADD CONSTRAINT "workspace_budgets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_workspace_created_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_workspace_kind_created_idx" ON "usage_events" USING btree ("workspace_id","kind","created_at");