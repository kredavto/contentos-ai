CREATE UNIQUE INDEX "auth_tokens_user_hash_uq" ON "auth_tokens" USING btree ("user_id","token_hash");
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"payload" jsonb,
	"correlation_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "email_outbox_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "email_status_valid" CHECK ("email_outbox"."status" in ('PENDING','SENDING','SENT','FAILED','CANCELED')),
	CONSTRAINT "email_attempt_valid" CHECK ("email_outbox"."attempt" between 0 and 8),
	CONSTRAINT "email_lease_valid" CHECK (("email_outbox"."status"='SENDING') = ("email_outbox"."lease_token" is not null and "email_outbox"."lease_until" is not null)),
	CONSTRAINT "email_payload_valid" CHECK (("email_outbox"."status" in ('PENDING','SENDING')) = ("email_outbox"."payload" is not null))
);
--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_user_id_token_hash_auth_tokens_user_id_token_hash_fk" FOREIGN KEY ("user_id","token_hash") REFERENCES "public"."auth_tokens"("user_id","token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_delivery_due_idx" ON "email_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint

CREATE FUNCTION guard_email_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.user_id,NEW.token_hash,NEW.correlation_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.token_hash,OLD.correlation_id,OLD.created_at)
    OR NEW.attempt<OLD.attempt OR (OLD.status IN ('SENT','FAILED','CANCELED') AND NEW IS DISTINCT FROM OLD)
    THEN RAISE EXCEPTION 'Email identity and terminal delivery are immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER email_delivery_guard BEFORE UPDATE ON email_outbox FOR EACH ROW EXECUTE FUNCTION guard_email_delivery();
