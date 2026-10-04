ALTER TABLE "video_projects" ADD COLUMN "lifecycle" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "delete_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "delete_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "delete_lease_token" uuid;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "delete_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "delete_error" text;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "delete_correlation_id" uuid;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "video_deletion_idx" ON "video_projects" USING btree ("lifecycle","delete_after");--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_lifecycle_valid" CHECK ("video_projects"."lifecycle" in ('ACTIVE','DELETE_PENDING','DELETED'));