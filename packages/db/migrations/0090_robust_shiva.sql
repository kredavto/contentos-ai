CREATE TABLE "account_erasures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"consent_version" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "account_erasure_user_uq" UNIQUE("user_id"),
	CONSTRAINT "account_erasure_request_uq" UNIQUE("request_id"),
	CONSTRAINT "account_erasure_intent_uq" UNIQUE("user_id","request_key"),
	CONSTRAINT "account_erasure_state_valid" CHECK ("account_erasures"."status" in ('QUEUED','BLOCKED','COMPLETED') and ("account_erasures"."status"='COMPLETED')=("account_erasures"."completed_at" is not null) and "account_erasures"."attempt" between 0 and 3 and "account_erasures"."consent_version"='ACCOUNT_AUTH_DATA_V1')
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_erasures" ADD CONSTRAINT "account_erasures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_erasures" ADD CONSTRAINT "account_erasures_request_id_account_deletion_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."account_deletion_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_erasure_due_idx" ON "account_erasures" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE FUNCTION protect_erased_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.erased_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
  RAISE EXCEPTION 'Erased account identity is immutable';
 END IF;
 IF NEW.erased_at IS NOT NULL AND (NEW.disabled_at IS NULL OR NEW.email_verified_at IS NOT NULL OR
 NEW.email <> 'deleted+' || NEW.id::text || '@account.invalid' OR NEW.name <> 'Удалённый аккаунт' OR NEW.password_hash <> 'ERASED:' || NEW.id::text) THEN
  RAISE EXCEPTION 'Invalid erased account identity';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER erased_account_guard BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION protect_erased_account();
--> statement-breakpoint
CREATE FUNCTION prevent_disabled_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE disabled timestamp with time zone;
BEGIN
 SELECT disabled_at INTO disabled FROM users WHERE id=NEW.user_id FOR SHARE;
 IF disabled IS NOT NULL THEN RAISE EXCEPTION 'Disabled accounts cannot join organizations'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER disabled_membership_guard BEFORE INSERT OR UPDATE OF user_id ON organization_members FOR EACH ROW EXECUTE FUNCTION prevent_disabled_membership();
--> statement-breakpoint
CREATE FUNCTION protect_account_erasure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Erasure consent history is immutable'; END IF;
 IF ROW(NEW.id,NEW.user_id,NEW.request_id,NEW.request_key,NEW.consent_version,NEW.correlation_id,NEW.created_at) IS DISTINCT FROM
 ROW(OLD.id,OLD.user_id,OLD.request_id,OLD.request_key,OLD.consent_version,OLD.correlation_id,OLD.created_at) OR
 (OLD.status<>'QUEUED' AND NEW IS DISTINCT FROM OLD) THEN RAISE EXCEPTION 'Erasure consent and terminal state are immutable'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_erasure_guard BEFORE UPDATE OR DELETE ON account_erasures FOR EACH ROW EXECUTE FUNCTION protect_account_erasure();
