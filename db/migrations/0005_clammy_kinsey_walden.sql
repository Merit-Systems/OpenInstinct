CREATE TABLE "agent_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"content_digest" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"active_revision_id" text,
	"created_at" text NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "agents_status_check" CHECK ("agents"."status" IN ('draft', 'active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_workspace_id_uidx" ON "agents" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_workspace_slug_uidx" ON "agents" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_revisions_workspace_id_uidx" ON "agent_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_revisions_agent_revision_number_uidx" ON "agent_revisions" USING btree ("agent_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_revisions_workspace_agent_id_uidx" ON "agent_revisions" USING btree ("workspace_id","agent_id","id");--> statement-breakpoint
ALTER TABLE "agent_revisions" ADD CONSTRAINT "agent_revisions_workspace_agent_fkey" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_active_revision_fkey" FOREIGN KEY ("workspace_id","id","active_revision_id") REFERENCES "public"."agent_revisions"("workspace_id","agent_id","id") ON DELETE no action ON UPDATE no action;
