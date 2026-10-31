ALTER TABLE "broll_segments" DROP CONSTRAINT "broll_project_uq";--> statement-breakpoint
ALTER TABLE "broll_segments" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "broll_segments" ADD CONSTRAINT "broll_project_position_uq" UNIQUE("tenant_id","project_id","position");--> statement-breakpoint
ALTER TABLE "broll_segments" ADD CONSTRAINT "broll_position_valid" CHECK ("broll_segments"."position" between 0 and 4);