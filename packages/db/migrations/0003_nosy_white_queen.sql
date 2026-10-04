CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"call" integer NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"input_units" integer,
	"output_units" integer,
	"provider_cost_microunits" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"output" jsonb,
	"duration_ms" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_call_order_uq" UNIQUE("job_id","attempt","call")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"input" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"external_job_id" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" uuid NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "jobs_idempotency_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "jobs_progress_valid" CHECK ("jobs"."progress" between 0 and 100),
	CONSTRAINT "jobs_attempt_valid" CHECK ("jobs"."attempt" >= 0 and "jobs"."max_attempts" between 1 and 10),
	CONSTRAINT "jobs_status_valid" CHECK ("jobs"."status" in ('QUEUED','RUNNING','RETRY','SUCCEEDED','FAILED'))
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"last_dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_brand_uq" UNIQUE("tenant_id","brand_id"),
	CONSTRAINT "strategy_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_version_uq" UNIQUE("strategy_id","version"),
	CONSTRAINT "strategy_version_job_uq" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "trial_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trial_grants_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reservation_id" uuid,
	"unit" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"available_delta" integer NOT NULL,
	"reserved_delta" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_key_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "ledger_unit_valid" CHECK ("usage_ledger"."unit" in ('AI_CREDITS','VIDEO_SECONDS')),
	CONSTRAINT "ledger_deltas_valid" CHECK ((
    ("usage_ledger"."type" in ('GRANT','PURCHASE','REFUND') and "usage_ledger"."amount" > 0 and "usage_ledger"."available_delta" = "usage_ledger"."amount" and "usage_ledger"."reserved_delta" = 0 and "usage_ledger"."reservation_id" is null) or
    ("usage_ledger"."type" = 'ADJUSTMENT' and "usage_ledger"."amount" <> 0 and "usage_ledger"."available_delta" = "usage_ledger"."amount" and "usage_ledger"."reserved_delta" = 0 and "usage_ledger"."reservation_id" is null) or
    ("usage_ledger"."type" = 'EXPIRE' and "usage_ledger"."amount" > 0 and "usage_ledger"."available_delta" = -"usage_ledger"."amount" and "usage_ledger"."reserved_delta" = 0 and "usage_ledger"."reservation_id" is null) or
    ("usage_ledger"."type" = 'RESERVE' and "usage_ledger"."amount" > 0 and "usage_ledger"."available_delta" = -"usage_ledger"."amount" and "usage_ledger"."reserved_delta" = "usage_ledger"."amount" and "usage_ledger"."reservation_id" is not null) or
    ("usage_ledger"."type" = 'CAPTURE' and "usage_ledger"."amount" > 0 and "usage_ledger"."available_delta" = 0 and "usage_ledger"."reserved_delta" = -"usage_ledger"."amount" and "usage_ledger"."reservation_id" is not null) or
    ("usage_ledger"."type" = 'RELEASE' and "usage_ledger"."amount" > 0 and "usage_ledger"."available_delta" = "usage_ledger"."amount" and "usage_ledger"."reserved_delta" = -"usage_ledger"."amount" and "usage_ledger"."reservation_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "usage_policies" (
	"operation" text PRIMARY KEY NOT NULL,
	"unit" text NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "usage_policy_positive" CHECK ("usage_policies"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"unit" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'HELD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_key_uq" UNIQUE("tenant_id","key"),
	CONSTRAINT "reservation_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "reservation_amount_positive" CHECK ("usage_reservations"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"idea_id" uuid,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'SCRIPT' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "ideas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"title" text NOT NULL,
	"angle" text NOT NULL,
	"hook" text NOT NULL,
	"audience_segment_id" uuid,
	"content_pillar_id" uuid,
	"audience_label" text NOT NULL,
	"pillar_label" text NOT NULL,
	"funnel_stage" text NOT NULL,
	"platform" text NOT NULL,
	"format" text NOT NULL,
	"score" integer NOT NULL,
	"scores" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ideas_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "ideas_job_ordinal_uq" UNIQUE("job_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "script_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"job_id" uuid,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_version_number_uq" UNIQUE("script_id","version"),
	CONSTRAINT "script_version_job_uq" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"approved_version" integer,
	"approved_by" uuid,
	"platform" text NOT NULL,
	"duration" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scripts_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_reservation_id_usage_reservations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."usage_reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_tenant_id_strategy_id_strategies_tenant_id_id_fk" FOREIGN KEY ("tenant_id","strategy_id") REFERENCES "public"."strategies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_grants" ADD CONSTRAINT "trial_grants_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_tenant_id_reservation_id_usage_reservations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."usage_reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_tenant_id_idea_id_ideas_tenant_id_id_fk" FOREIGN KEY ("tenant_id","idea_id") REFERENCES "public"."ideas"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_tenant_id_audience_segment_id_audience_segments_tenant_id_id_fk" FOREIGN KEY ("tenant_id","audience_segment_id") REFERENCES "public"."audience_segments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_tenant_id_content_pillar_id_content_pillars_tenant_id_id_fk" FOREIGN KEY ("tenant_id","content_pillar_id") REFERENCES "public"."content_pillars"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_tenant_id_script_id_scripts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","script_id") REFERENCES "public"."scripts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_tenant_id_content_item_id_content_items_tenant_id_id_fk" FOREIGN KEY ("tenant_id","content_item_id") REFERENCES "public"."content_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_dispatch_idx" ON "jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "ledger_balance_idx" ON "usage_ledger" USING btree ("tenant_id","unit");--> statement-breakpoint
CREATE FUNCTION contentos_reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Append-only history cannot be updated or deleted' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usage_ledger_immutable BEFORE UPDATE OR DELETE ON usage_ledger FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER strategy_versions_immutable BEFORE UPDATE OR DELETE ON strategy_versions FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER script_versions_immutable BEFORE UPDATE OR DELETE ON script_versions FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE UNIQUE INDEX ledger_reserve_once ON usage_ledger (reservation_id) WHERE type = 'RESERVE';
--> statement-breakpoint
CREATE UNIQUE INDEX ledger_settle_once ON usage_ledger (reservation_id) WHERE type IN ('CAPTURE', 'RELEASE');
--> statement-breakpoint
CREATE FUNCTION contentos_check_ledger_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reservation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM usage_reservations r WHERE r.id = NEW.reservation_id AND r.tenant_id = NEW.tenant_id AND r.unit = NEW.unit AND r.amount = NEW.amount AND r.status = 'HELD'
  ) THEN
    RAISE EXCEPTION 'Ledger entry does not match an active reservation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usage_ledger_reservation_check BEFORE INSERT ON usage_ledger FOR EACH ROW EXECUTE FUNCTION contentos_check_ledger_reservation();
--> statement-breakpoint
ALTER TABLE usage_reservations ADD CONSTRAINT reservation_unit_valid CHECK (unit IN ('AI_CREDITS','VIDEO_SECONDS'));
--> statement-breakpoint
ALTER TABLE usage_reservations ADD CONSTRAINT reservation_status_valid CHECK (status IN ('HELD','CAPTURED','RELEASED'));
--> statement-breakpoint
ALTER TABLE usage_policies ADD CONSTRAINT policy_unit_valid CHECK (unit IN ('AI_CREDITS','VIDEO_SECONDS'));
--> statement-breakpoint
INSERT INTO usage_policies (operation, unit, amount) VALUES ('TRIAL','AI_CREDITS',100), ('GENERATE_STRATEGY','AI_CREDITS',10), ('GENERATE_IDEAS','AI_CREDITS',3), ('GENERATE_SCRIPT','AI_CREDITS',2);
