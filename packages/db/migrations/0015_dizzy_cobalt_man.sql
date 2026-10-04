CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"reference" jsonb NOT NULL,
	"url" text,
	"published_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publication_job_uq" UNIQUE("job_id"),
	CONSTRAINT "publication_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "publishing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"calendar_id" uuid NOT NULL,
	"calendar_revision" integer NOT NULL,
	"content_item_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"credential_version" integer NOT NULL,
	"type" text DEFAULT 'PUBLISH_CONTENT' NOT NULL,
	"provider" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"approved_by" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishing_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "publishing_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "publishing_revision_uq" UNIQUE("calendar_id","calendar_revision"),
	CONSTRAINT "publishing_state_valid" CHECK ("publishing_jobs"."status" in ('SCHEDULED','PREPARING','SUBMITTING','PUBLISHED','FAILED','CANCELLED','RECONCILIATION')),
	CONSTRAINT "publishing_attempt_valid" CHECK ("publishing_jobs"."attempt" >= 0 and "publishing_jobs"."calendar_revision" >= 0 and "publishing_jobs"."credential_version" > 0),
	CONSTRAINT "publishing_type_valid" CHECK ("publishing_jobs"."type" = 'PUBLISH_CONTENT')
);
--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_tenant_id_job_id_publishing_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."publishing_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_tenant_id_calendar_id_calendar_entries_tenant_id_id_fk" FOREIGN KEY ("tenant_id","calendar_id") REFERENCES "public"."calendar_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_tenant_id_content_item_id_content_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","content_item_id") REFERENCES "public"."content_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_jobs" ADD CONSTRAINT "publishing_jobs_tenant_id_connection_id_social_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publishing_due_idx" ON "publishing_jobs" USING btree ("status","next_attempt_at","dispatch_after");
--> statement-breakpoint
CREATE FUNCTION contentos_protect_publishing_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Publishing approval history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(OLD) - ARRAY['status','attempt','next_attempt_at','dispatch_after','lease_token','lease_expires_at','submitted_at','finished_at','error_code']) IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY['status','attempt','next_attempt_at','dispatch_after','lease_token','lease_expires_at','submitted_at','finished_at','error_code']) THEN
    RAISE EXCEPTION 'Publishing approval intent is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER publishing_intent_immutable BEFORE UPDATE OR DELETE ON publishing_jobs FOR EACH ROW EXECUTE FUNCTION contentos_protect_publishing_intent();
--> statement-breakpoint
CREATE TRIGGER publications_immutable BEFORE UPDATE OR DELETE ON publications FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
