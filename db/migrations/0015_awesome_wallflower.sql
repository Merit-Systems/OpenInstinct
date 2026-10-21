CREATE TABLE "memory_artifacts" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"pathname" text NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"sha256" text NOT NULL,
	"record_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_artifacts_workspace_id_scope_key_pathname_pk" PRIMARY KEY("workspace_id","scope_key","pathname")
);
--> statement-breakpoint
CREATE TABLE "memory_bindings" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"namespace" text NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"capture_after" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"capture_disabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_binding_cursor_check" CHECK ("memory_bindings"."cursor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "memory_generations" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"generation" integer NOT NULL,
	"deletion_epoch" integer NOT NULL,
	"profile" text NOT NULL,
	"current_context" text NOT NULL,
	"record_ids" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_generations_workspace_id_scope_key_generation_pk" PRIMARY KEY("workspace_id","scope_key","generation")
);
--> statement-breakpoint
CREATE TABLE "memory_jobs" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"epoch" integer NOT NULL,
	"published_generation" integer,
	"source_versions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checkpoint" jsonb,
	"lease_token" uuid,
	"lease_expires_at" timestamp (3) with time zone,
	"available_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_legacy_imports" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"legacy_scope_key" text NOT NULL,
	"imported_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_legacy_imports_workspace_id_legacy_scope_key_pk" PRIMARY KEY("workspace_id","legacy_scope_key")
);
--> statement-breakpoint
CREATE TABLE "memory_links" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"relation" text NOT NULL,
	CONSTRAINT "memory_links_workspace_id_scope_key_from_id_to_id_relation_pk" PRIMARY KEY("workspace_id","scope_key","from_id","to_id","relation")
);
--> statement-breakpoint
CREATE TABLE "memory_recall_results" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"operation_id" text NOT NULL,
	"deletion_epoch" integer NOT NULL,
	"result" jsonb,
	"invalidated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_recall_results_workspace_id_scope_key_operation_id_pk" PRIMARY KEY("workspace_id","scope_key","operation_id")
);
--> statement-breakpoint
CREATE TABLE "memory_records" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"id" text NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb,
	"explicit" boolean DEFAULT false NOT NULL,
	"last_operation_id" text NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_records_workspace_id_scope_key_id_pk" PRIMARY KEY("workspace_id","scope_key","id"),
	CONSTRAINT "memory_record_revision_check" CHECK ("memory_records"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "memory_revisions" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"record_id" text NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb NOT NULL,
	"explicit" boolean NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_revisions_workspace_id_scope_key_record_id_revision_pk" PRIMARY KEY("workspace_id","scope_key","record_id","revision")
);
--> statement-breakpoint
CREATE TABLE "memory_sources" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text,
	"reference" text,
	"session_id" text,
	"turn_id" text,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_sources_workspace_id_scope_key_id_pk" PRIMARY KEY("workspace_id","scope_key","id")
);
--> statement-breakpoint
CREATE TABLE "memory_state" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"deletion_epoch" integer DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"input_revision" integer DEFAULT 0 NOT NULL,
	"forget_before" timestamp (3) with time zone,
	CONSTRAINT "memory_state_workspace_id_scope_key_pk" PRIMARY KEY("workspace_id","scope_key")
);
--> statement-breakpoint
ALTER TABLE "memory_bindings" ADD CONSTRAINT "memory_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_bindings" ADD CONSTRAINT "memory_bindings_session_id_agent_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("session_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_generations" ADD CONSTRAINT "memory_generations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_jobs" ADD CONSTRAINT "memory_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_legacy_imports" ADD CONSTRAINT "memory_legacy_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_links" ADD CONSTRAINT "memory_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_recall_results" ADD CONSTRAINT "memory_recall_results_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_records" ADD CONSTRAINT "memory_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_revisions" ADD CONSTRAINT "memory_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_sources" ADD CONSTRAINT "memory_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_state" ADD CONSTRAINT "memory_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_artifacts_cleanup_idx" ON "memory_artifacts" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "memory_bindings_scope_idx" ON "memory_bindings" USING btree ("workspace_id","scope_key");--> statement-breakpoint
CREATE INDEX "memory_jobs_ready_idx" ON "memory_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "memory_jobs_scope_idx" ON "memory_jobs" USING btree ("workspace_id","scope_key");--> statement-breakpoint
CREATE INDEX "memory_records_recent_idx" ON "memory_records" USING btree ("workspace_id","scope_key","updated_at");--> statement-breakpoint
CREATE INDEX "memory_sources_pending_idx" ON "memory_sources" USING btree ("workspace_id","scope_key","status","created_at");