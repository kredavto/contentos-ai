CREATE TABLE "broll_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"source_start_ms" integer NOT NULL,
	"source" text DEFAULT 'USER_MEDIA' NOT NULL,
	"prompt" text,
	"approved" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broll_project_uq" UNIQUE("tenant_id","project_id"),
	CONSTRAINT "broll_source_valid" CHECK ("broll_segments"."source" = 'USER_MEDIA' and "broll_segments"."prompt" is null and "broll_segments"."approved" = true),
	CONSTRAINT "broll_timing_valid" CHECK ("broll_segments"."start_ms" >= 0 and "broll_segments"."end_ms" <= 180000 and "broll_segments"."end_ms" - "broll_segments"."start_ms" >= 100 and "broll_segments"."source_start_ms" >= 0 and "broll_segments"."source_start_ms" + "broll_segments"."end_ms" - "broll_segments"."start_ms" <= 180000)
);
--> statement-breakpoint
ALTER TABLE "broll_segments" ADD CONSTRAINT "broll_segments_tenant_id_project_id_video_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."video_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broll_segments" ADD CONSTRAINT "broll_segments_tenant_id_asset_id_library_media_tenant_id_id_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."library_media"("tenant_id","id") ON DELETE no action ON UPDATE no action;