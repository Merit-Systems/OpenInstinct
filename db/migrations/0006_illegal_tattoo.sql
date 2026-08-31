CREATE TABLE "user_profiles" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text,
	"email" text,
	"phone" text,
	"date_of_birth" text,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country_code" text,
	"updated_at" text NOT NULL,
	CONSTRAINT "user_profiles_country_code_check" CHECK ("user_profiles"."country_code" IS NULL OR char_length("user_profiles"."country_code") = 2)
);
--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;