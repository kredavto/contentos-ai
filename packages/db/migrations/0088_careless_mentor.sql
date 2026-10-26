CREATE TABLE "comment_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempt_id" uuid,
	"attempted_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"external_comment_id" text,
	"published_at" timestamp with time zone,
	"error_code" text,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_delivery_tenant_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "comment_delivery_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "comment_delivery_approval_uq" UNIQUE("tenant_id","approval_id"),
	CONSTRAINT "comment_delivery_status_valid" CHECK ("comment_deliveries"."status" in ('QUEUED','ATTEMPTED','REJECTED','RECONCILIATION_REQUIRED','SUCCEEDED')),
	CONSTRAINT "comment_delivery_attempt_valid" CHECK ((("comment_deliveries"."attempt_id" is null and "comment_deliveries"."attempted_at" is null and "comment_deliveries"."status" in ('QUEUED','REJECTED')) or ("comment_deliveries"."attempt_id" is not null and "comment_deliveries"."attempted_at" is not null and "comment_deliveries"."status"<>'QUEUED'))),
	CONSTRAINT "comment_delivery_lease_valid" CHECK ((("comment_deliveries"."status"='ATTEMPTED' and "comment_deliveries"."lease_expires_at" is not null) or ("comment_deliveries"."status"<>'ATTEMPTED' and "comment_deliveries"."lease_expires_at" is null))),
	CONSTRAINT "comment_delivery_receipt_valid" CHECK ((("comment_deliveries"."status"='SUCCEEDED' and "comment_deliveries"."external_comment_id" is not null and "comment_deliveries"."published_at" is not null and "comment_deliveries"."attempt_id" is not null) or ("comment_deliveries"."status"<>'SUCCEEDED' and "comment_deliveries"."external_comment_id" is null and "comment_deliveries"."published_at" is null)))
);
--> statement-breakpoint
ALTER TABLE "comment_deliveries" ADD CONSTRAINT "comment_deliveries_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_deliveries" ADD CONSTRAINT "comment_delivery_approval_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."comment_reply_approvals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_delivery_due_idx" ON "comment_deliveries" USING btree ("status","dispatch_after");--> statement-breakpoint
CREATE FUNCTION protect_comment_delivery_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'comment delivery history is immutable'; END IF;
 IF ROW(NEW.id,NEW.tenant_id,NEW.approval_id,NEW.requested_by,NEW.idempotency_key,NEW.correlation_id,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.approval_id,OLD.requested_by,OLD.idempotency_key,OLD.correlation_id,OLD.created_at)
 THEN RAISE EXCEPTION 'comment delivery intent is immutable'; END IF;
 IF OLD.attempt_id IS NOT NULL AND ROW(NEW.attempt_id,NEW.attempted_at) IS DISTINCT FROM ROW(OLD.attempt_id,OLD.attempted_at)
 THEN RAISE EXCEPTION 'comment delivery attempt is immutable'; END IF;
 IF OLD.status IN ('SUCCEEDED','REJECTED') AND NEW IS DISTINCT FROM OLD
 THEN RAISE EXCEPTION 'comment delivery is terminal'; END IF;
 IF (OLD.status='ATTEMPTED' AND NEW.status NOT IN ('ATTEMPTED','SUCCEEDED','REJECTED','RECONCILIATION_REQUIRED')) OR
 (OLD.status='RECONCILIATION_REQUIRED' AND NEW.status NOT IN ('RECONCILIATION_REQUIRED','SUCCEEDED'))
 THEN RAISE EXCEPTION 'comment delivery cannot be replayed'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER protect_comment_delivery_attempt BEFORE UPDATE OR DELETE ON comment_deliveries FOR EACH ROW EXECUTE FUNCTION protect_comment_delivery_attempt();
