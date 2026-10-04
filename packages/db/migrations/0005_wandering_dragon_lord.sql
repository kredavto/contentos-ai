CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'PHOTO' NOT NULL,
	"status" text DEFAULT 'UPLOADING' NOT NULL,
	"provider" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"input_hash" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"delete_attempts" integer DEFAULT 0 NOT NULL,
	"delete_after" timestamp with time zone,
	"error_code" text,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_assets_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "media_upload_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "media_status_valid" CHECK ("media_assets"."status" in ('UPLOADING','READY','DELETE_PENDING','DELETED')),
	CONSTRAINT "media_photo_valid" CHECK ("media_assets"."kind" = 'PHOTO' and "media_assets"."mime_type" = 'image/jpeg' and "media_assets"."bytes" between 1 and 3145728 and "media_assets"."width" between 1 and 2048 and "media_assets"."height" between 1 and 2048),
	CONSTRAINT "media_key_tenant" CHECK ("media_assets"."storage_key" like "media_assets"."tenant_id"::text || '/%'),
	CONSTRAINT "media_hash_valid" CHECK ("media_assets"."sha256" ~ '^[a-f0-9]{64}$' and "media_assets"."input_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_brand_idx" ON "media_assets" USING btree ("tenant_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "media_cleanup_idx" ON "media_assets" USING btree ("status","delete_after");