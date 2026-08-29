CREATE TABLE "phone_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"encrypted_phone_number" text NOT NULL,
	"phone_lookup_hash" text NOT NULL,
	"status" text DEFAULT 'verified' NOT NULL,
	"verified_at" text NOT NULL,
	"revoked_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "phone_identities_status_check" CHECK ("phone_identities"."status" IN ('verified', 'revoked', 'recycled'))
);
--> statement-breakpoint
ALTER TABLE "phone_identities" ADD CONSTRAINT "phone_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "phone_identities_verified_lookup_hash_uidx" ON "phone_identities" USING btree ("phone_lookup_hash") WHERE "phone_identities"."status" = 'verified';--> statement-breakpoint
CREATE INDEX "phone_identities_user_id_idx" ON "phone_identities" USING btree ("user_id");