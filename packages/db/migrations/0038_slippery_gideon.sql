CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"request_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "account_deletion_state_valid" CHECK (("account_deletion_requests"."status" = 'REQUESTED' and "account_deletion_requests"."cancelled_at" is null) or ("account_deletion_requests"."status" = 'CANCELLED' and "account_deletion_requests"."cancelled_at" is not null and "account_deletion_requests"."cancelled_at" >= "account_deletion_requests"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_intent_uq" ON "account_deletion_requests" USING btree ("user_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "account_deletion_active_uq" ON "account_deletion_requests" USING btree ("user_id") WHERE "account_deletion_requests"."status" = 'REQUESTED';--> statement-breakpoint
CREATE FUNCTION protect_account_deletion_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.user_id,NEW.request_key,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.request_key,OLD.created_at)
     OR OLD.status <> 'REQUESTED' OR NEW.status <> 'CANCELLED' OR NEW.revision = OLD.revision THEN
    RAISE EXCEPTION 'Deletion request identity and terminal state are immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER account_deletion_request_update_guard BEFORE UPDATE ON account_deletion_requests FOR EACH ROW EXECUTE FUNCTION protect_account_deletion_request();
