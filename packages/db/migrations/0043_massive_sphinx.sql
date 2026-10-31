CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"job_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_version_uq" UNIQUE("post_id","version"),
	CONSTRAINT "post_version_job_uq" UNIQUE("job_id"),
	CONSTRAINT "post_version_positive" CHECK ("content_versions"."version">0)
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"approved_version" integer,
	"approved_by" uuid,
	"platform" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "posts_content_uq" UNIQUE("content_item_id"),
	CONSTRAINT "posts_version_valid" CHECK ("posts"."current_version">0 and ("posts"."approved_version" is null or "posts"."approved_version"="posts"."current_version"))
);
--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_tenant_id_post_id_posts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","post_id") REFERENCES "public"."posts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_tenant_id_brand_id_content_item_id_content_items_tenant_id_brand_id_id_fk" FOREIGN KEY ("tenant_id","brand_id","content_item_id") REFERENCES "public"."content_items"("tenant_id","brand_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER content_versions_immutable BEFORE UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
INSERT INTO usage_policies(operation,unit,amount) VALUES ('GENERATE_POST','AI_CREDITS',2);
