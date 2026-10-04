CREATE TABLE "billing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"ai_credits" integer NOT NULL,
	"video_seconds" integer NOT NULL,
	"provider" text NOT NULL,
	"merchant_id" text NOT NULL,
	"test" boolean NOT NULL,
	"input" jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_order_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "billing_order_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "billing_order_kind_valid" CHECK ("billing_orders"."kind" in ('START','RENEWAL','UPGRADE')),
	CONSTRAINT "billing_order_amount_valid" CHECK ("billing_orders"."amount_minor" between 1 and 1000000000 and "billing_orders"."currency" = 'RUB' and "billing_orders"."ai_credits" between 0 and 1000000000 and "billing_orders"."video_seconds" between 0 and 1000000000),
	CONSTRAINT "billing_order_input_valid" CHECK ("billing_orders"."input"->>'currency' = "billing_orders"."currency" and ("billing_orders"."input"->>'amountMinor')::numeric = "billing_orders"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "payment_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"observation" jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_settlement_order_uq" UNIQUE("tenant_id","order_id"),
	CONSTRAINT "payment_settlement_payment_uq" UNIQUE("tenant_id","payment_id"),
	CONSTRAINT "payment_settlement_paid_valid" CHECK ("payment_settlements"."observation"->>'status' = 'SUCCEEDED' and "payment_settlements"."observation"->>'paid' = 'true')
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"merchant_id" text NOT NULL,
	"test" boolean NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "payment_order_uq" UNIQUE("tenant_id","order_id"),
	CONSTRAINT "payment_external_uq" UNIQUE("provider","merchant_id","test","external_id")
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'RUB' NOT NULL,
	"ai_credits" integer NOT NULL,
	"video_seconds" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_version_uq" UNIQUE("plan_id","version"),
	CONSTRAINT "plan_version_valid" CHECK ("plan_versions"."version" > 0 and "plan_versions"."amount_minor" between 0 and 1000000000 and "plan_versions"."currency" = 'RUB' and "plan_versions"."ai_credits" between 0 and 1000000000 and "plan_versions"."video_seconds" between 0 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_code_uq" UNIQUE("code"),
	CONSTRAINT "plan_code_valid" CHECK ("plans"."code" in ('FREE','START','CREATOR','EXPERT','AGENCY'))
);
--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_tenant_id_order_id_billing_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."billing_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_tenant_id_payment_id_payments_tenant_id_id_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_order_id_billing_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."billing_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_order_tenant_created_idx" ON "billing_orders" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE TRIGGER plan_versions_append_only BEFORE UPDATE OR DELETE ON plan_versions FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER billing_orders_append_only BEFORE UPDATE OR DELETE ON billing_orders FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER payment_settlements_append_only BEFORE UPDATE OR DELETE ON payment_settlements FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION contentos_validate_payment_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM billing_orders o WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND o.provider=NEW.provider AND o.merchant_id=NEW.merchant_id AND o.test=NEW.test)
  THEN RAISE EXCEPTION 'Payment identity does not match order'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_identity_guard BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION contentos_validate_payment_identity();
--> statement-breakpoint
CREATE FUNCTION contentos_validate_settlement_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM billing_orders o JOIN payments p ON p.tenant_id=o.tenant_id AND p.order_id=o.id
    WHERE o.id=NEW.order_id AND o.tenant_id=NEW.tenant_id AND p.id=NEW.payment_id
      AND NEW.observation->>'provider'=o.provider AND NEW.observation->>'merchantId'=o.merchant_id
      AND NEW.observation->>'externalId'=p.external_id AND NEW.observation->>'internalId'=o.id::text
      AND NEW.observation->>'test'=o.test::text AND NEW.observation->>'currency'=o.currency
      AND (NEW.observation->>'amountMinor')::numeric=o.amount_minor
      AND NEW.observation->>'status'='SUCCEEDED' AND NEW.observation->>'paid'='true'
  ) THEN RAISE EXCEPTION 'Settlement evidence does not match payment'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settlement_identity_guard BEFORE INSERT ON payment_settlements FOR EACH ROW EXECUTE FUNCTION contentos_validate_settlement_identity();
--> statement-breakpoint
INSERT INTO plans(code,name,enabled) VALUES ('FREE','FREE',false),('START','START',false),('CREATOR','CREATOR',false),('EXPERT','EXPERT',false),('AGENCY','AGENCY',false);
