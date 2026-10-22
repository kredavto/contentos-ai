CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"entity_type" text DEFAULT 'SCRIPT' NOT NULL,
	"script_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_from" uuid NOT NULL,
	"request_comment" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"comment" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_intent_uq" UNIQUE("tenant_id","requested_by","idempotency_key"),
	CONSTRAINT "approval_valid" CHECK ("approval_requests"."entity_type"='SCRIPT' and "approval_requests"."version">0 and length("approval_requests"."request_comment")<=2000 and length(coalesce("approval_requests"."comment",''))<=2000 and "approval_requests"."input_hash" ~ '^[a-f0-9]{64}$' and "approval_requests"."status" in ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED') and (("approval_requests"."status"='PENDING' and "approval_requests"."resolved_by" is null and "approval_requests"."resolved_at" is null and "approval_requests"."comment" is null) or ("approval_requests"."status"<>'PENDING' and "approval_requests"."resolved_by" is not null and "approval_requests"."resolved_at" is not null and "approval_requests"."comment" is not null)))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_from_users_id_fk" FOREIGN KEY ("requested_from") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_script_id_scripts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","script_id") REFERENCES "public"."scripts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_script_id_version_script_versions_tenant_id_script_id_version_fk" FOREIGN KEY ("tenant_id","script_id","version") REFERENCES "public"."script_versions"("tenant_id","script_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_pending_script_uq" ON "approval_requests" USING btree ("tenant_id","script_id") WHERE "approval_requests"."status"='PENDING';--> statement-breakpoint
CREATE INDEX "approval_tenant_created_idx" ON "approval_requests" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE FUNCTION contentos_protect_approval_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'PENDING' OR NOT EXISTS (SELECT 1 FROM scripts WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.script_id) THEN
      RAISE EXCEPTION 'Invalid approval target or initial state' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Approval evidence cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF OLD.status <> 'PENDING' OR
    (NEW.id,NEW.tenant_id,NEW.brand_id,NEW.entity_type,NEW.script_id,NEW.version,NEW.requested_by,NEW.requested_from,NEW.request_comment,NEW.idempotency_key,NEW.input_hash,NEW.created_at)
      IS DISTINCT FROM
    (OLD.id,OLD.tenant_id,OLD.brand_id,OLD.entity_type,OLD.script_id,OLD.version,OLD.requested_by,OLD.requested_from,OLD.request_comment,OLD.idempotency_key,OLD.input_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'Approval identity and terminal evidence are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER approval_request_immutable BEFORE INSERT OR UPDATE OR DELETE ON approval_requests FOR EACH ROW EXECUTE FUNCTION contentos_protect_approval_request();
