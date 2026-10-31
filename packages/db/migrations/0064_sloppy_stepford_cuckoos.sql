CREATE TABLE "youtube_resolution_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"input" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"resolution_id" uuid,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "youtube_resolution_task_intent_uq" UNIQUE("actor_id","request_key"),
	CONSTRAINT "youtube_resolution_task_valid" CHECK ("youtube_resolution_tasks"."status" in ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED') and "youtube_resolution_tasks"."attempt" between 0 and 3 and "youtube_resolution_tasks"."input_hash" ~ '^[a-f0-9]{64}$' and "youtube_resolution_tasks"."input"->>'tenantId'="youtube_resolution_tasks"."tenant_id"::text and "youtube_resolution_tasks"."input"->>'jobId'="youtube_resolution_tasks"."job_id"::text and "youtube_resolution_tasks"."input"->>'idempotencyKey'="youtube_resolution_tasks"."request_key"::text)
);
--> statement-breakpoint
ALTER TABLE "youtube_resolution_tasks" ADD CONSTRAINT "youtube_resolution_tasks_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_resolution_tasks" ADD CONSTRAINT "youtube_resolution_tasks_resolution_id_youtube_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."youtube_resolutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_resolution_tasks" ADD CONSTRAINT "youtube_resolution_tasks_tenant_id_job_id_publishing_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."publishing_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "youtube_resolution_task_pending_uq" ON "youtube_resolution_tasks" USING btree ("tenant_id","job_id") WHERE "youtube_resolution_tasks"."status" in ('QUEUED','RUNNING');--> statement-breakpoint
CREATE INDEX "youtube_resolution_task_due_idx" ON "youtube_resolution_tasks" USING btree ("status","next_attempt_at","dispatch_after");
--> statement-breakpoint
CREATE FUNCTION contentos_protect_youtube_resolution_task() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR ROW(NEW.id,NEW.tenant_id,NEW.job_id,NEW.actor_id,NEW.request_key,NEW.input,NEW.input_hash,NEW.correlation_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.job_id,OLD.actor_id,OLD.request_key,OLD.input,OLD.input_hash,OLD.correlation_id,OLD.created_at)
    OR (OLD.status IN ('SUCCEEDED','FAILED','CANCELLED') AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'YouTube resolution task identity and terminal evidence are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER youtube_resolution_task_immutable BEFORE UPDATE OR DELETE ON youtube_resolution_tasks FOR EACH ROW EXECUTE FUNCTION contentos_protect_youtube_resolution_task();
