CREATE TABLE "channel_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_conversation_id" text NOT NULL,
	"platform_line_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"pinned_revision_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "channel_conversations_status_check" CHECK ("channel_conversations"."status" IN ('active', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "channel_participants" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"phone_identity_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "channel_participants_role_check" CHECK ("channel_participants"."role" IN ('owner', 'participant')),
	CONSTRAINT "channel_participants_status_check" CHECK ("channel_participants"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "platform_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_line_id" text NOT NULL,
	"connector_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"environment" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "platform_lines_provider_check" CHECK ("platform_lines"."provider" IN ('linq')),
	CONSTRAINT "platform_lines_status_check" CHECK ("platform_lines"."status" IN ('active', 'suspended', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_platform_line_id_fkey" FOREIGN KEY ("platform_line_id") REFERENCES "public"."platform_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_workspace_agent_fkey" FOREIGN KEY ("workspace_id","agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_conversations" ADD CONSTRAINT "channel_conversations_workspace_agent_revision_fkey" FOREIGN KEY ("workspace_id","agent_id","pinned_revision_id") REFERENCES "public"."agent_revisions"("workspace_id","agent_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_participants" ADD CONSTRAINT "channel_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."channel_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_participants" ADD CONSTRAINT "channel_participants_phone_identity_id_fkey" FOREIGN KEY ("phone_identity_id") REFERENCES "public"."phone_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_conversations_provider_conversation_uidx" ON "channel_conversations" USING btree ("provider","provider_account_id","provider_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_participants_conversation_identity_uidx" ON "channel_participants" USING btree ("conversation_id","phone_identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_lines_provider_line_uidx" ON "platform_lines" USING btree ("provider","provider_line_id");