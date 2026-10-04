CREATE TABLE "captions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"confirmed_revision" integer,
	"source" text NOT NULL,
	"segments" jsonb NOT NULL,
	"style" text DEFAULT 'clean' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caption_project_uq" UNIQUE("project_id"),
	CONSTRAINT "caption_revision_valid" CHECK ("captions"."revision" >= 0 and ("captions"."confirmed_revision" is null or "captions"."confirmed_revision" = "captions"."revision"))
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_status_valid";--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "caption_mode" text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "caption_language" text DEFAULT 'ru' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "caption_provider" text;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "caption_model" text;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "caption_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "caption_mutation_state" text DEFAULT 'NONE' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "original_stored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "source_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "captions" ADD CONSTRAINT "captions_tenant_id_project_id_video_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."video_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_tenant_id_caption_reservation_id_usage_reservations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","caption_reservation_id") REFERENCES "public"."usage_reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_status_valid" CHECK ("jobs"."status" in ('QUEUED','RUNNING','RETRY','SUCCEEDED','FAILED','WAITING_EXTERNAL','WAITING_REVIEW','RECONCILIATION'));--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_caption_mode_valid" CHECK ("video_projects"."caption_mode" in ('NONE','MANUAL','AUTO'));--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_caption_mutation_valid" CHECK ("video_projects"."caption_mutation_state" in ('NONE','STARTED','UNKNOWN','ACCEPTED','REJECTED'));
--> statement-breakpoint
INSERT INTO usage_policies (operation, unit, amount) VALUES ('AUTO_CAPTIONS', 'AI_CREDITS', 3) ON CONFLICT (operation) DO NOTHING;
