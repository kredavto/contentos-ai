CREATE TABLE "carousel_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"carousel_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"job_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carousel_version_uq" UNIQUE("carousel_id","version"),
	CONSTRAINT "carousel_version_job_uq" UNIQUE("job_id"),
	CONSTRAINT "carousel_version_positive" CHECK ("carousel_versions"."version">0)
);
--> statement-breakpoint
CREATE TABLE "carousels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"approved_version" integer,
	"approved_by" uuid,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carousels_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "carousels_content_uq" UNIQUE("content_item_id"),
	CONSTRAINT "carousels_version_valid" CHECK ("carousels"."current_version">0 and ("carousels"."approved_version" is null or "carousels"."approved_version"="carousels"."current_version"))
);
--> statement-breakpoint
ALTER TABLE "carousel_versions" ADD CONSTRAINT "carousel_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carousel_versions" ADD CONSTRAINT "carousel_versions_tenant_id_carousel_id_carousels_tenant_id_id_fk" FOREIGN KEY ("tenant_id","carousel_id") REFERENCES "public"."carousels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carousel_versions" ADD CONSTRAINT "carousel_versions_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carousels" ADD CONSTRAINT "carousels_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carousels" ADD CONSTRAINT "carousels_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carousels" ADD CONSTRAINT "carousels_tenant_id_brand_id_content_item_id_content_items_tenant_id_brand_id_id_fk" FOREIGN KEY ("tenant_id","brand_id","content_item_id") REFERENCES "public"."content_items"("tenant_id","brand_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER carousel_versions_immutable BEFORE UPDATE OR DELETE ON carousel_versions FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
INSERT INTO usage_policies(operation,unit,amount) VALUES ('GENERATE_CAROUSEL','AI_CREDITS',4);
