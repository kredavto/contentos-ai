CREATE TABLE "subscription_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"anchor_at" timestamp with time zone NOT NULL,
	"month_index" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_term_order_uq" UNIQUE("tenant_id","order_id"),
	CONSTRAINT "subscription_term_period_valid" CHECK ("subscription_terms"."month_index" between 1 and 1200 and "subscription_terms"."ends_at" > "subscription_terms"."starts_at" and "subscription_terms"."starts_at" = (("subscription_terms"."anchor_at" at time zone 'UTC') + make_interval(months => "subscription_terms"."month_index" - 1)) at time zone 'UTC' and "subscription_terms"."ends_at" = (("subscription_terms"."anchor_at" at time zone 'UTC') + make_interval(months => "subscription_terms"."month_index")) at time zone 'UTC')
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_tenant_uq" UNIQUE("tenant_id"),
	CONSTRAINT "subscription_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "subscription_terms" ADD CONSTRAINT "subscription_terms_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_terms" ADD CONSTRAINT "subscription_terms_tenant_id_subscription_id_subscriptions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","subscription_id") REFERENCES "public"."subscriptions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_terms" ADD CONSTRAINT "subscription_terms_tenant_id_order_id_payment_settlements_tenant_id_order_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."payment_settlements"("tenant_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_term_current_idx" ON "subscription_terms" USING btree ("tenant_id","starts_at","ends_at");--> statement-breakpoint
CREATE TRIGGER subscription_terms_append_only BEFORE UPDATE OR DELETE ON subscription_terms FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION contentos_validate_subscription_term() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM organizations WHERE id=NEW.tenant_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM billing_orders WHERE tenant_id=NEW.tenant_id AND id=NEW.order_id AND plan_version_id=NEW.plan_version_id)
  THEN RAISE EXCEPTION 'Subscription plan does not match paid order'; END IF;
  IF EXISTS (SELECT 1 FROM subscription_terms WHERE tenant_id=NEW.tenant_id AND starts_at < NEW.ends_at AND ends_at > NEW.starts_at)
  THEN RAISE EXCEPTION 'Paid subscription terms cannot overlap'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_term_guard BEFORE INSERT ON subscription_terms FOR EACH ROW EXECUTE FUNCTION contentos_validate_subscription_term();
