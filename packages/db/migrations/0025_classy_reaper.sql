CREATE TABLE "payment_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"first_submitted_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_dispatched_at" timestamp with time zone,
	"error_code" text,
	"observation" jsonb,
	"confirmation_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_task_status_valid" CHECK ("payment_tasks"."status" in ('QUEUED','RUNNING','WAITING','SUCCEEDED','FAILED','CANCELED','RECONCILIATION')),
	CONSTRAINT "payment_task_attempt_valid" CHECK ("payment_tasks"."attempt" >= 0 and "payment_tasks"."submission_count" >= 0 and (("payment_tasks"."first_submitted_at" is null and "payment_tasks"."submission_count" = 0) or ("payment_tasks"."first_submitted_at" is not null and "payment_tasks"."submission_count" > 0))),
	CONSTRAINT "payment_task_lease_valid" CHECK (("payment_tasks"."status" = 'RUNNING' and "payment_tasks"."lease_token" is not null and "payment_tasks"."lease_expires_at" is not null) or ("payment_tasks"."status" <> 'RUNNING' and "payment_tasks"."lease_token" is null and "payment_tasks"."lease_expires_at" is null))
);
--> statement-breakpoint
ALTER TABLE "payment_tasks" ADD CONSTRAINT "payment_tasks_tenant_id_id_billing_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","id") REFERENCES "public"."billing_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_task_dispatch_idx" ON "payment_tasks" USING btree ("status","next_attempt_at");
--> statement-breakpoint
CREATE FUNCTION guard_payment_task_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR (OLD.first_submitted_at IS NOT NULL AND NEW.first_submitted_at IS DISTINCT FROM OLD.first_submitted_at)
    OR NEW.submission_count < OLD.submission_count OR NEW.attempt < OLD.attempt THEN
    RAISE EXCEPTION 'Payment task identity and submission history cannot change';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_task_identity_guard BEFORE UPDATE ON payment_tasks FOR EACH ROW EXECUTE FUNCTION guard_payment_task_identity();
