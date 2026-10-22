ALTER TABLE "email_outbox" DROP CONSTRAINT "email_status_valid";--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_status_valid" CHECK ("email_outbox"."status" in ('PENDING','SENDING','SENT','FAILED','CANCELED','RECONCILIATION'));
--> statement-breakpoint
-- Existing in-flight attempts may already have reached SMTP.
UPDATE email_outbox SET submitted_at=now() WHERE status='SENDING';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_email_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.user_id,NEW.token_hash,NEW.correlation_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.token_hash,OLD.correlation_id,OLD.created_at)
    OR NEW.attempt<OLD.attempt OR (OLD.status IN ('SENT','FAILED','CANCELED','RECONCILIATION') AND NEW IS DISTINCT FROM OLD)
    THEN RAISE EXCEPTION 'Email identity and terminal delivery are immutable'; END IF;
  RETURN NEW;
END $$;
