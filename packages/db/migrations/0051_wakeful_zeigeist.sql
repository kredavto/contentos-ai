CREATE TABLE "video_music" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"volume_percent" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_music_project_uq" UNIQUE("tenant_id","project_id"),
	CONSTRAINT "video_music_volume_valid" CHECK ("video_music"."volume_percent" between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "video_music" ADD CONSTRAINT "video_music_tenant_id_project_id_video_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."video_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_music" ADD CONSTRAINT "video_music_tenant_id_asset_id_library_media_tenant_id_id_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."library_media"("tenant_id","id") ON DELETE no action ON UPDATE no action;