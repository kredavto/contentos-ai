CREATE TABLE "channel_analytics_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"credential_version" integer NOT NULL,
	"provider" text NOT NULL,
	"source" text NOT NULL,
	"type" text DEFAULT 'FETCH_ANALYTICS' NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"idempotency_key" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_analytics_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "channel_analytics_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "channel_analytics_state_valid" CHECK ("channel_analytics_jobs"."status" in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
	CONSTRAINT "channel_analytics_source_valid" CHECK ("channel_analytics_jobs"."source" in ('API','DEMO')),
	CONSTRAINT "channel_analytics_type_valid" CHECK ("channel_analytics_jobs"."type" = 'FETCH_ANALYTICS'),
	CONSTRAINT "channel_analytics_attempt_valid" CHECK ("channel_analytics_jobs"."attempt" between 0 and 3 and "channel_analytics_jobs"."credential_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "channel_metric_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"metric_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "channel_evidence_metric_uq" UNIQUE("metric_id")
);
--> statement-breakpoint
CREATE TABLE "channel_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"source" text NOT NULL,
	"member_count" bigint NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_metrics_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "channel_metrics_job_uq" UNIQUE("job_id"),
	CONSTRAINT "channel_metrics_count_valid" CHECK ("channel_metrics"."member_count" between 0 and 1000000000000),
	CONSTRAINT "channel_metrics_source_valid" CHECK ("channel_metrics"."source" in ('API','DEMO'))
);
--> statement-breakpoint
ALTER TABLE "channel_analytics_jobs" ADD CONSTRAINT "channel_analytics_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_analytics_jobs" ADD CONSTRAINT "channel_analytics_jobs_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_analytics_jobs" ADD CONSTRAINT "channel_analytics_jobs_tenant_id_connection_id_social_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_metric_evidence" ADD CONSTRAINT "channel_metric_evidence_tenant_id_metric_id_channel_metrics_tenant_id_id_fk" FOREIGN KEY ("tenant_id","metric_id") REFERENCES "public"."channel_metrics"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_metrics" ADD CONSTRAINT "channel_metrics_tenant_id_job_id_channel_analytics_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."channel_analytics_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_metrics" ADD CONSTRAINT "channel_metrics_tenant_id_connection_id_social_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_analytics_due_idx" ON "channel_analytics_jobs" USING btree ("status","next_attempt_at","dispatch_after");--> statement-breakpoint
CREATE INDEX "channel_analytics_connection_idx" ON "channel_analytics_jobs" USING btree ("tenant_id","connection_id","created_at");--> statement-breakpoint
CREATE INDEX "channel_metrics_history_idx" ON "channel_metrics" USING btree ("tenant_id","connection_id","observed_at");
--> statement-breakpoint
CREATE TRIGGER channel_metrics_append_only BEFORE UPDATE OR DELETE ON channel_metrics FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER channel_evidence_append_only BEFORE UPDATE OR DELETE ON channel_metric_evidence FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION contentos_preserve_channel_analytics_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Analytics intent is immutable'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','attempt','next_attempt_at','dispatch_after','lease_token','lease_expires_at','started_at','finished_at','error_code']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','attempt','next_attempt_at','dispatch_after','lease_token','lease_expires_at','started_at','finished_at','error_code']) THEN RAISE EXCEPTION 'Analytics intent is immutable'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER channel_analytics_intent_immutable BEFORE UPDATE OR DELETE ON channel_analytics_jobs FOR EACH ROW EXECUTE FUNCTION contentos_preserve_channel_analytics_intent();
