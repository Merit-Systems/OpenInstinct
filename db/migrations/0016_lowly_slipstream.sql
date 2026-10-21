CREATE TABLE "memory_model_usage" (
	"workspace_id" text NOT NULL,
	"scope_key" text NOT NULL,
	"job_id" uuid NOT NULL,
	"lease_token" uuid NOT NULL,
	"day" text NOT NULL,
	"model_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"accepted_claims" integer,
	"response_model_id" text,
	"provider" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"outcome" text,
	"reserved_tokens" integer NOT NULL,
	"charged_tokens" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp (3) with time zone,
	CONSTRAINT "memory_model_usage_workspace_id_job_id_lease_token_pk" PRIMARY KEY("workspace_id","job_id","lease_token"),
	CONSTRAINT "memory_usage_reservation_check" CHECK ("memory_model_usage"."reserved_tokens" > 0 AND "memory_model_usage"."charged_tokens" >= 0)
);
--> statement-breakpoint
ALTER TABLE "memory_model_usage" ADD CONSTRAINT "memory_model_usage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memory_model_usage_day_idx" ON "memory_model_usage" USING btree ("workspace_id","day");