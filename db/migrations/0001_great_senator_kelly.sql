CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"eve_session_id" text NOT NULL,
	"eve_turn_id" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"feedback" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "feedback_category_check" CHECK ("feedback"."category" IN ('general', 'bug', 'idea', 'compliment')),
	CONSTRAINT "feedback_content_check" CHECK (length(btrim("feedback"."feedback")) BETWEEN 1 AND 4000),
	CONSTRAINT "feedback_status_check" CHECK ("feedback"."status" IN ('new', 'reviewed', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_session_id_fkey" FOREIGN KEY ("eve_session_id") REFERENCES "public"."agent_sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_workspace_idempotency_idx" ON "feedback" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "feedback_review_queue_idx" ON "feedback" USING btree ("status","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "feedback_workspace_created_idx" ON "feedback" USING btree ("workspace_id","created_at" DESC NULLS FIRST);