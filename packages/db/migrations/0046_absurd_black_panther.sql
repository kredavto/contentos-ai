CREATE TABLE "generated_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"name" text NOT NULL,
	"input" jsonb,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"storage_key" text NOT NULL,
	"reservation_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"reference" jsonb,
	"usage" jsonb,
	"submitted_at" timestamp with time zone,
	"bytes" integer,
	"sha256" text,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"delete_after" timestamp with time zone,
	"delete_attempts" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "generated_images_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "image_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "image_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "image_status_valid" CHECK ("generated_images"."status" in ('QUEUED','RUNNING','SUBMITTING','READY','FAILED','RECONCILIATION','DELETE_PENDING','DELETED')),
	CONSTRAINT "image_input_valid" CHECK (("generated_images"."status"='DELETED' and "generated_images"."input" is null) or ("generated_images"."status"<>'DELETED' and "generated_images"."input" is not null)),
	CONSTRAINT "image_key_tenant" CHECK ("generated_images"."storage_key" like "generated_images"."tenant_id"::text || '/%'),
	CONSTRAINT "image_bytes_valid" CHECK ("generated_images"."bytes" is null or "generated_images"."bytes" between 1 and 3145728),
	CONSTRAINT "image_ready_valid" CHECK ("generated_images"."status"<>'READY' or ("generated_images"."bytes" is not null and "generated_images"."sha256" ~ '^[a-f0-9]{64}$' and "generated_images"."submitted_at" is not null)),
	CONSTRAINT "image_attempt_valid" CHECK ("generated_images"."attempt">=0 and "generated_images"."delete_attempts">=0)
);
--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "generated_images_tenant_id_reservation_id_usage_reservations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reservation_id") REFERENCES "public"."usage_reservations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "image_dispatch_idx" ON "generated_images" USING btree ("status","dispatch_after");--> statement-breakpoint
CREATE INDEX "image_cleanup_idx" ON "generated_images" USING btree ("delete_after");--> statement-breakpoint
INSERT INTO usage_policies(operation,unit,amount) VALUES ('GENERATE_IMAGE','AI_CREDITS',8);
--> statement-breakpoint
CREATE FUNCTION contentos_image_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Image task history cannot be deleted'; END IF;
  IF (to_jsonb(NEW)-ARRAY['name','input','status','reference','usage','submitted_at','bytes','sha256','approved_at','approved_by','attempt','lease_token','lease_expires_at','dispatch_after','error_code','finished_at','delete_after','delete_attempts','deleted_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','input','status','reference','usage','submitted_at','bytes','sha256','approved_at','approved_by','attempt','lease_token','lease_expires_at','dispatch_after','error_code','finished_at','delete_after','delete_attempts','deleted_at']) THEN RAISE EXCEPTION 'Image identity is immutable'; END IF;
  IF (NEW.input IS DISTINCT FROM OLD.input OR NEW.name IS DISTINCT FROM OLD.name) AND NOT (NEW.status='DELETED' AND NEW.input IS NULL AND NEW.name='[deleted]') THEN RAISE EXCEPTION 'Image request is immutable'; END IF;
  IF OLD.usage IS NOT NULL AND NEW.usage IS DISTINCT FROM OLD.usage THEN RAISE EXCEPTION 'Image metering is immutable'; END IF;
  IF OLD.reference IS NOT NULL AND NEW.reference IS DISTINCT FROM OLD.reference AND NOT (NEW.status='DELETED' AND NEW.reference IS NULL) THEN RAISE EXCEPTION 'Image reference is immutable'; END IF;
  IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN RAISE EXCEPTION 'Image submission is immutable'; END IF;
  IF OLD.status='SUBMITTING' AND NEW.status IN ('QUEUED','RUNNING') THEN RAISE EXCEPTION 'Image submission must not be replayed'; END IF;
  IF OLD.status IN ('READY','FAILED','RECONCILIATION','DELETE_PENDING','DELETED') AND NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status<>'DELETED' AND NEW.status='DELETE_PENDING') AND NOT (OLD.status='DELETE_PENDING' AND NEW.status='DELETED') THEN RAISE EXCEPTION 'Image terminal state cannot be reopened'; END IF;
  IF OLD.bytes IS NOT NULL AND NEW.bytes IS DISTINCT FROM OLD.bytes THEN RAISE EXCEPTION 'Image output is immutable'; END IF;
  IF OLD.sha256 IS NOT NULL AND NEW.sha256 IS DISTINCT FROM OLD.sha256 AND NOT (NEW.status='DELETED' AND NEW.sha256 IS NULL) THEN RAISE EXCEPTION 'Image checksum is immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER image_identity_immutable BEFORE UPDATE OR DELETE ON generated_images FOR EACH ROW EXECUTE FUNCTION contentos_image_guard();
