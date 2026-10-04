CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"merchant_id" text NOT NULL,
	"test" boolean NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"external_id" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_dispatched_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_provider_event_uq" UNIQUE("provider","merchant_id","test","provider_event_id"),
	CONSTRAINT "webhook_status_valid" CHECK ("webhook_events"."status" in ('RECEIVED','PROCESSING','RETRY','PROCESSED','IGNORED','RECONCILIATION')),
	CONSTRAINT "webhook_attempt_valid" CHECK ("webhook_events"."attempt" >= 0),
	CONSTRAINT "webhook_lease_valid" CHECK (("webhook_events"."status" = 'PROCESSING' and "webhook_events"."lease_token" is not null and "webhook_events"."lease_expires_at" is not null) or ("webhook_events"."status" <> 'PROCESSING' and "webhook_events"."lease_token" is null and "webhook_events"."lease_expires_at" is null))
);
--> statement-breakpoint
CREATE INDEX "webhook_dispatch_idx" ON "webhook_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE FUNCTION guard_webhook_receipt_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id OR NEW.test IS DISTINCT FROM OLD.test OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id OR NEW.event_type IS DISTINCT FROM OLD.event_type OR NEW.external_id IS DISTINCT FROM OLD.external_id OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Webhook receipt identity cannot change';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER webhook_receipt_identity_guard BEFORE UPDATE ON webhook_events FOR EACH ROW EXECUTE FUNCTION guard_webhook_receipt_identity();
