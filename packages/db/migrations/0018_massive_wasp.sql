ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_tenant_version_uq" UNIQUE("tenant_id","strategy_id","version");--> statement-breakpoint
CREATE TABLE "performance_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"strategy_version" integer NOT NULL,
	"brand_revision" integer NOT NULL,
	"evidence" jsonb NOT NULL,
	"output" jsonb NOT NULL,
	"provider" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_report_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "performance_report_job_uq" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "strategy_recommendation_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recommendation_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"strategy_id" uuid NOT NULL,
	"applied_version" integer,
	"actor_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_decision_uq" UNIQUE("recommendation_id"),
	CONSTRAINT "recommendation_decision_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "recommendation_decision_valid" CHECK (("strategy_recommendation_decisions"."decision" = 'ACCEPTED' and "strategy_recommendation_decisions"."applied_version" is not null) or ("strategy_recommendation_decisions"."decision" = 'REJECTED' and "strategy_recommendation_decisions"."applied_version" is null))
);
--> statement-breakpoint
CREATE TABLE "strategy_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "recommendation_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "recommendation_ordinal_uq" UNIQUE("report_id","ordinal"),
	CONSTRAINT "recommendation_ordinal_valid" CHECK ("strategy_recommendations"."ordinal" between 0 and 2)
);
--> statement-breakpoint
ALTER TABLE "strategy_versions" ALTER COLUMN "job_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reports" ADD CONSTRAINT "performance_reports_tenant_id_strategy_id_strategy_version_strategy_versions_tenant_id_strategy_id_version_fk" FOREIGN KEY ("tenant_id","strategy_id","strategy_version") REFERENCES "public"."strategy_versions"("tenant_id","strategy_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_recommendation_decisions" ADD CONSTRAINT "strategy_recommendation_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_recommendation_decisions" ADD CONSTRAINT "strategy_recommendation_decisions_tenant_id_recommendation_id_strategy_recommendations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","recommendation_id") REFERENCES "public"."strategy_recommendations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_recommendation_decisions" ADD CONSTRAINT "strategy_recommendation_decisions_tenant_id_strategy_id_applied_version_strategy_versions_tenant_id_strategy_id_version_fk" FOREIGN KEY ("tenant_id","strategy_id","applied_version") REFERENCES "public"."strategy_versions"("tenant_id","strategy_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_recommendations" ADD CONSTRAINT "strategy_recommendations_tenant_id_report_id_performance_reports_tenant_id_id_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."performance_reports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "performance_report_brand_idx" ON "performance_reports" USING btree ("tenant_id","brand_id","created_at");--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_version_author_valid" CHECK ("strategy_versions"."job_id" is not null or "strategy_versions"."created_by" is not null);
--> statement-breakpoint
INSERT INTO usage_policies(operation,unit,amount) VALUES('OPTIMIZE_STRATEGY','AI_CREDITS',5) ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE TRIGGER performance_reports_append_only BEFORE UPDATE OR DELETE ON performance_reports FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER strategy_recommendations_append_only BEFORE UPDATE OR DELETE ON strategy_recommendations FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER recommendation_decisions_append_only BEFORE UPDATE OR DELETE ON strategy_recommendation_decisions FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
