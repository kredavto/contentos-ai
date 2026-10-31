CREATE TABLE "publication_analytics_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
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
	CONSTRAINT "publication_analytics_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "publication_analytics_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "publication_analytics_provider_valid" CHECK ("publication_analytics_jobs"."provider" = 'youtube'),
	CONSTRAINT "publication_analytics_state_valid" CHECK ("publication_analytics_jobs"."status" in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
	CONSTRAINT "publication_analytics_source_valid" CHECK ("publication_analytics_jobs"."source" = 'API'),
	CONSTRAINT "publication_analytics_type_valid" CHECK ("publication_analytics_jobs"."type" = 'FETCH_ANALYTICS'),
	CONSTRAINT "publication_analytics_attempt_valid" CHECK ("publication_analytics_jobs"."attempt" between 0 and 3 and "publication_analytics_jobs"."credential_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "publication_analytics_jobs" ADD CONSTRAINT "publication_analytics_jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_analytics_jobs" ADD CONSTRAINT "publication_analytics_jobs_tenant_id_publication_id_publications_tenant_id_id_fk" FOREIGN KEY ("tenant_id","publication_id") REFERENCES "public"."publications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_analytics_jobs" ADD CONSTRAINT "publication_analytics_jobs_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_analytics_jobs" ADD CONSTRAINT "publication_analytics_jobs_tenant_id_connection_id_social_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_analytics_due_idx" ON "publication_analytics_jobs" USING btree ("status","next_attempt_at","dispatch_after");--> statement-breakpoint
CREATE INDEX "publication_analytics_publication_idx" ON "publication_analytics_jobs" USING btree ("tenant_id","publication_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_analytics_pending_uq" ON "publication_analytics_jobs" USING btree ("tenant_id","publication_id") WHERE "publication_analytics_jobs"."status" in ('QUEUED','RUNNING');