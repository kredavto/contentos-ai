ALTER TABLE "script_versions" ADD CONSTRAINT "script_version_tenant_number_uq" UNIQUE("tenant_id","script_id","version");
--> statement-breakpoint
CREATE TABLE "brand_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"script_version" integer NOT NULL,
	"brand_revision" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_reviews_job_uq" UNIQUE("job_id")
);
--> statement-breakpoint
ALTER TABLE "brand_reviews" ADD CONSTRAINT "brand_reviews_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_reviews" ADD CONSTRAINT "brand_reviews_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_reviews" ADD CONSTRAINT "brand_reviews_tenant_id_script_id_script_version_script_versions_tenant_id_script_id_version_fk" FOREIGN KEY ("tenant_id","script_id","script_version") REFERENCES "public"."script_versions"("tenant_id","script_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "brand_reviews_scope_idx" ON "brand_reviews" USING btree ("tenant_id","brand_id","created_at");--> statement-breakpoint

--> statement-breakpoint
CREATE TRIGGER brand_reviews_immutable BEFORE UPDATE OR DELETE ON brand_reviews FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
INSERT INTO usage_policies(operation,unit,amount) VALUES ('REVIEW_SCRIPT','AI_CREDITS',2);
