DO $$
DECLARE
	was_validated boolean;
BEGIN
	SELECT convalidated
	INTO was_validated
	FROM pg_constraint
	WHERE conrelid = 'public.workspace_memberships'::regclass
		AND conname = 'workspace_memberships_role_check';

	ALTER TABLE "workspace_memberships" DROP CONSTRAINT IF EXISTS "workspace_memberships_role_check";
	ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_role_check" CHECK ("workspace_memberships"."role" IN ('owner', 'admin', 'member')) NOT VALID;

	IF was_validated THEN
		ALTER TABLE "workspace_memberships" VALIDATE CONSTRAINT "workspace_memberships_role_check";
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD COLUMN "invited_by_user_id" text;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD COLUMN "invited_at" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "lifecycle_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "policy_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_status_check" CHECK ("workspace_memberships"."status" IN ('active', 'invited', 'revoked'));--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_lifecycle_state_check" CHECK ("workspaces"."lifecycle_state" IN ('trial', 'active', 'suspended', 'pending_deletion', 'deleted'));
