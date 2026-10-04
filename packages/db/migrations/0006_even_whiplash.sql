CREATE TABLE "avatar_looks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"avatar_id" uuid NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"reference" jsonb,
	"mutation_state" text DEFAULT 'NONE' NOT NULL,
	"first_submitted_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avatar_look_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "avatar_look_job_uq" UNIQUE("job_id"),
	CONSTRAINT "avatar_look_status_valid" CHECK ("avatar_looks"."status" in ('QUEUED','PROCESSING','READY','FAILED','RECONCILIATION')),
	CONSTRAINT "avatar_mutation_state_valid" CHECK ("avatar_looks"."mutation_state" in ('NONE','STARTED','ACCEPTED','REJECTED','UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE "avatars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"reference" jsonb,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"delete_attempts" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "avatar_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "avatar_status_valid" CHECK ("avatars"."status" in ('ACTIVE','DELETE_PENDING','DELETED'))
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_status_valid";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "poll_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "avatar_looks" ADD CONSTRAINT "avatar_looks_tenant_id_avatar_id_avatars_tenant_id_id_fk" FOREIGN KEY ("tenant_id","avatar_id") REFERENCES "public"."avatars"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatar_looks" ADD CONSTRAINT "avatar_looks_tenant_id_source_asset_id_media_assets_tenant_id_id_fk" FOREIGN KEY ("tenant_id","source_asset_id") REFERENCES "public"."media_assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatar_looks" ADD CONSTRAINT "avatar_looks_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_tenant_id_subject_id_consent_subjects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "public"."consent_subjects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatar_look_parent_idx" ON "avatar_looks" USING btree ("tenant_id","avatar_id");--> statement-breakpoint
CREATE INDEX "avatar_brand_idx" ON "avatars" USING btree ("tenant_id","brand_id");--> statement-breakpoint
CREATE INDEX "avatar_deletion_idx" ON "avatars" USING btree ("status","delete_after");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_valid" CHECK ("jobs"."status" in ('QUEUED','RUNNING','RETRY','SUCCEEDED','FAILED','WAITING_EXTERNAL','RECONCILIATION'));
--> statement-breakpoint
INSERT INTO usage_policies(operation, unit, amount) VALUES ('CREATE_AVATAR', 'AI_CREDITS', 5) ON CONFLICT (operation) DO NOTHING;
