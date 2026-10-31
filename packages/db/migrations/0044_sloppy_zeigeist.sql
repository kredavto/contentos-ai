CREATE TABLE "covers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"requested_by" uuid NOT NULL,
	"design" jsonb,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"storage_key" text NOT NULL,
	"reservation_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "covers_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "cover_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "cover_project_version_uq" UNIQUE("project_id","version"),
	CONSTRAINT "cover_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "cover_version_valid" CHECK ("covers"."version" > 0 and "covers"."attempt" >= 0),
	CONSTRAINT "cover_status_valid" CHECK ("covers"."status" in ('QUEUED','RUNNING','READY','FAILED','CANCELLED','DELETED')),
	CONSTRAINT "cover_design_valid" CHECK (("covers"."status" = 'DELETED' and "covers"."design" is null) or ("covers"."status" <> 'DELETED' and "covers"."design" is not null)),
	CONSTRAINT "cover_key_tenant" CHECK ("covers"."storage_key" like "covers"."tenant_id"::text || '/%')
);
--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "cover_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "cover_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "covers" ADD CONSTRAINT "covers_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "covers" ADD CONSTRAINT "covers_tenant_id_project_id_video_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."video_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "covers" ADD CONSTRAINT "covers_tenant_id_reservation_id_usage_reservations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."usage_reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cover_one_pending_uq" ON "covers" USING btree ("project_id") WHERE "covers"."status" in ('QUEUED','RUNNING');--> statement-breakpoint
CREATE INDEX "cover_dispatch_idx" ON "covers" USING btree ("status","dispatch_after");--> statement-breakpoint
INSERT INTO usage_policies(operation,unit,amount) VALUES ('GENERATE_COVER','AI_CREDITS',1);
--> statement-breakpoint
CREATE FUNCTION contentos_cover_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Cover history cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - ARRAY['design','status','attempt','lease_token','lease_expires_at','next_attempt_at','dispatch_after','error_code','finished_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['design','status','attempt','lease_token','lease_expires_at','next_attempt_at','dispatch_after','error_code','finished_at']) THEN RAISE EXCEPTION 'Cover identity is immutable'; END IF;
  IF NEW.design IS DISTINCT FROM OLD.design AND NOT (NEW.status = 'DELETED' AND NEW.design IS NULL AND EXISTS (SELECT 1 FROM video_projects v WHERE v.id=NEW.project_id AND v.tenant_id=NEW.tenant_id AND v.lifecycle='DELETED')) THEN RAISE EXCEPTION 'Cover design is immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER cover_identity_immutable BEFORE UPDATE OR DELETE ON covers FOR EACH ROW EXECUTE FUNCTION contentos_cover_identity_guard();
