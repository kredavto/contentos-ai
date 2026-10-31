CREATE TABLE "video_bookends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"asset_id" uuid NOT NULL,
	"source_start_ms" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"approved" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_bookends_project_slot_uq" UNIQUE("tenant_id","project_id","slot"),
	CONSTRAINT "video_bookends_slot_valid" CHECK ("video_bookends"."slot" in ('intro','outro')),
	CONSTRAINT "video_bookends_approved" CHECK ("video_bookends"."approved" = true),
	CONSTRAINT "video_bookends_timing_valid" CHECK ("video_bookends"."source_start_ms" >= 0 and "video_bookends"."duration_ms" between 100 and 30000 and "video_bookends"."source_start_ms" + "video_bookends"."duration_ms" <= 180000)
);
--> statement-breakpoint
ALTER TABLE "video_bookends" ADD CONSTRAINT "video_bookends_tenant_id_project_id_video_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."video_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_bookends" ADD CONSTRAINT "video_bookends_tenant_id_asset_id_library_media_tenant_id_id_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."library_media"("tenant_id","id") ON DELETE no action ON UPDATE no action;