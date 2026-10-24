ALTER TABLE "notifications" ADD CONSTRAINT "notification_tenant_recipient_id_uq" UNIQUE("tenant_id","user_id","id");--> statement-breakpoint
CREATE TABLE "notification_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"preference_revision" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "notification_email_deliveries_notification_id_unique" UNIQUE("notification_id"),
	CONSTRAINT "notification_email_status_valid" CHECK ("notification_email_deliveries"."status" in ('PENDING','SENDING','SENT','FAILED','CANCELED','RECONCILIATION')),
	CONSTRAINT "notification_email_attempt_valid" CHECK ("notification_email_deliveries"."attempt" between 0 and 8),
	CONSTRAINT "notification_email_lease_valid" CHECK (("notification_email_deliveries"."status"='SENDING')=("notification_email_deliveries"."lease_token" is not null and "notification_email_deliveries"."lease_until" is not null))
);
--> statement-breakpoint
ALTER TABLE "notification_email_deliveries" ADD CONSTRAINT "notification_email_deliveries_tenant_id_user_id_notification_id_notifications_tenant_id_user_id_id_fk" FOREIGN KEY ("tenant_id","user_id","notification_id") REFERENCES "public"."notifications"("tenant_id","user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_email_due_idx" ON "notification_email_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint

CREATE FUNCTION guard_notification_email_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.user_id,NEW.notification_id,NEW.preference_revision,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.user_id,OLD.notification_id,OLD.preference_revision,OLD.created_at)
 OR NEW.attempt<OLD.attempt OR (OLD.status IN ('SENT','FAILED','CANCELED','RECONCILIATION') AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'Notification delivery identity and terminal state are immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER notification_email_delivery_guard BEFORE UPDATE ON notification_email_deliveries FOR EACH ROW EXECUTE FUNCTION guard_notification_email_delivery();
