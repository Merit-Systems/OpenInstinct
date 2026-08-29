CREATE TABLE "connection_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"connector_id" text NOT NULL,
	"authorization_subject" text NOT NULL,
	"scopes" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"revoked_at" text,
	CONSTRAINT "connection_installations_provider_check" CHECK ("connection_installations"."provider" IN ('google', 'linq')),
	CONSTRAINT "connection_installations_status_check" CHECK ("connection_installations"."status" IN ('active', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "connection_installations" ADD CONSTRAINT "connection_installations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_installations_workspace_connector_subject_uidx" ON "connection_installations" USING btree ("workspace_id","provider","connector_id","authorization_subject");