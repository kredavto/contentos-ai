CREATE TABLE "utm_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"destination_url" text NOT NULL,
	"tagged_url" text NOT NULL,
	"source" text NOT NULL,
	"medium" text NOT NULL,
	"campaign" text NOT NULL,
	"term" text DEFAULT '' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utm_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "utm_revision_valid" CHECK ("utm_links"."revision" >= 0),
	CONSTRAINT "utm_urls_valid" CHECK ("utm_links"."destination_url" ~ '^https?://' and "utm_links"."tagged_url" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "utm_links" ADD CONSTRAINT "utm_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utm_links" ADD CONSTRAINT "utm_links_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "utm_brand_page_idx" ON "utm_links" USING btree ("tenant_id","brand_id","id");