CREATE TABLE "account_erasure_recoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"erasure_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"previous_recovery_id" uuid,
	"request_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"reason" text NOT NULL,
	"ticket" text NOT NULL,
	"previous_attempt" integer NOT NULL,
	"previous_error_code" text,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_erasure_recovery_scope_uq" UNIQUE("erasure_id","id"),
	CONSTRAINT "account_erasure_recovery_intent_uq" UNIQUE("actor_id","request_key"),
	CONSTRAINT "account_erasure_recovery_valid" CHECK ("account_erasure_recoveries"."reason" in ('DEPENDENCIES_RESOLVED','TRANSIENT_FAILURE_RESOLVED') and "account_erasure_recoveries"."ticket" ~ '^[A-Za-z0-9_-]{3,80}$' and "account_erasure_recoveries"."input_hash" ~ '^[a-f0-9]{64}$' and "account_erasure_recoveries"."previous_attempt" between 0 and 3)
);
--> statement-breakpoint
ALTER TABLE "account_erasures" ADD COLUMN "recovery_id" uuid;--> statement-breakpoint
ALTER TABLE "account_erasure_recoveries" ADD CONSTRAINT "account_erasure_recoveries_erasure_id_account_erasures_id_fk" FOREIGN KEY ("erasure_id") REFERENCES "public"."account_erasures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_erasure_recoveries" ADD CONSTRAINT "account_erasure_recoveries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_erasure_recoveries" ADD CONSTRAINT "account_erasure_recovery_previous_fk" FOREIGN KEY ("erasure_id","previous_recovery_id") REFERENCES "public"."account_erasure_recoveries"("erasure_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_erasure_recovery_history_idx" ON "account_erasure_recoveries" USING btree ("erasure_id","created_at","id");--> statement-breakpoint
ALTER TABLE "account_erasures" ADD CONSTRAINT "account_erasure_recovery_scope_fk" FOREIGN KEY ("id","recovery_id") REFERENCES "public"."account_erasure_recoveries"("erasure_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_account_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Erasure consent history is immutable'; END IF;
 IF ROW(NEW.id,NEW.user_id,NEW.request_id,NEW.request_key,NEW.consent_version,NEW.correlation_id,NEW.created_at) IS DISTINCT FROM
 ROW(OLD.id,OLD.user_id,OLD.request_id,OLD.request_key,OLD.consent_version,OLD.correlation_id,OLD.created_at) THEN
  RAISE EXCEPTION 'Erasure consent is immutable';
 END IF;
 IF OLD.status='COMPLETED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Completed erasure is immutable'; END IF;
 IF OLD.status='QUEUED' AND NEW.recovery_id IS DISTINCT FROM OLD.recovery_id THEN RAISE EXCEPTION 'Recovery requires blocked execution'; END IF;
 IF OLD.status='BLOCKED' AND NEW IS DISTINCT FROM OLD THEN
  IF NEW.status<>'QUEUED' OR NEW.attempt<>0 OR NEW.error_code IS NOT NULL OR NEW.recovery_id IS NULL OR NEW.recovery_id IS NOT DISTINCT FROM OLD.recovery_id OR NOT EXISTS (
   SELECT 1 FROM account_erasure_recoveries r WHERE r.id=NEW.recovery_id AND r.erasure_id=OLD.id
    AND r.previous_recovery_id IS NOT DISTINCT FROM OLD.recovery_id AND r.previous_attempt=OLD.attempt
    AND r.previous_error_code IS NOT DISTINCT FROM OLD.error_code
  ) THEN RAISE EXCEPTION 'Blocked erasure requires fresh scoped recovery evidence'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION protect_account_erasure_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Erasure recovery history is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_erasure_recovery_guard BEFORE UPDATE OR DELETE ON account_erasure_recoveries FOR EACH ROW EXECUTE FUNCTION protect_account_erasure_recovery();
