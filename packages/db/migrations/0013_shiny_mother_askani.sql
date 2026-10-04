CREATE TABLE "calendar_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"video_project_id" uuid,
	"planned_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"platform" text NOT NULL,
	"caption" text NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"privacy" text DEFAULT 'PUBLIC' NOT NULL,
	"comments_enabled" boolean DEFAULT true NOT NULL,
	"publishing_mode" text DEFAULT 'APPROVAL' NOT NULL,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "calendar_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "calendar_content_uq" UNIQUE("content_item_id"),
	CONSTRAINT "calendar_revision_valid" CHECK ("calendar_entries"."revision" >= 0),
	CONSTRAINT "calendar_status_valid" CHECK ("calendar_entries"."status" in ('PLANNED','CANCELLED')),
	CONSTRAINT "calendar_mode_valid" CHECK ("calendar_entries"."publishing_mode" in ('MANUAL','APPROVAL')),
	CONSTRAINT "calendar_privacy_valid" CHECK ("calendar_entries"."privacy" in ('PUBLIC','UNLISTED','PRIVATE'))
);
--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_tenant_id_content_item_id_content_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","content_item_id") REFERENCES "public"."content_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_tenant_id_video_project_id_video_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","video_project_id") REFERENCES "public"."video_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_window_idx" ON "calendar_entries" USING btree ("tenant_id","brand_id","planned_at");