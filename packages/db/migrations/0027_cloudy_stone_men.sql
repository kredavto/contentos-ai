ALTER TABLE "subscription_terms" ADD CONSTRAINT "subscription_term_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "billing_renewal_intents" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"method_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewal_intent_term_uq" UNIQUE("tenant_id","term_id")
);
--> statement-breakpoint
ALTER TABLE "billing_renewal_intents" ADD CONSTRAINT "billing_renewal_intents_tenant_id_order_id_billing_orders_tenant_id_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."billing_orders"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_renewal_intents" ADD CONSTRAINT "billing_renewal_intents_tenant_id_term_id_subscription_terms_tenant_id_id_fk" FOREIGN KEY ("tenant_id","term_id") REFERENCES "public"."subscription_terms"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_renewal_intents" ADD CONSTRAINT "billing_renewal_intents_tenant_id_method_id_billing_payment_methods_tenant_id_order_id_fk" FOREIGN KEY ("tenant_id","method_id") REFERENCES "public"."billing_payment_methods"("tenant_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_order_no_plaintext_method" CHECK (not ("billing_orders"."input" ? 'paymentMethodId'));--> statement-breakpoint
CREATE FUNCTION guard_renewal_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Renewal intent is immutable'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM billing_orders o
    JOIN billing_payment_methods m ON m.tenant_id=o.tenant_id AND m.id=NEW.method_id
    JOIN billing_orders source ON source.tenant_id=m.tenant_id AND source.id=m.order_id
    JOIN subscription_terms t ON t.tenant_id=o.tenant_id AND t.id=NEW.term_id
    WHERE o.tenant_id=NEW.tenant_id AND o.id=NEW.order_id AND o.kind='RENEWAL' AND o.input->>'mode'='RENEWAL'
      AND m.consent_id=o.renewal_consent_id AND m.renewal_revision=o.renewal_revision AND m.revoked_at IS NULL AND m.credential IS NOT NULL
      AND source.provider=o.provider AND source.merchant_id=o.merchant_id AND source.test=o.test AND t.plan_version_id=o.plan_version_id
  ) THEN RAISE EXCEPTION 'Renewal method and term must match the immutable order'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER renewal_intent_guard BEFORE INSERT OR UPDATE OR DELETE ON billing_renewal_intents FOR EACH ROW EXECUTE FUNCTION guard_renewal_intent();
--> statement-breakpoint
CREATE FUNCTION require_renewal_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='RENEWAL' AND NOT EXISTS (SELECT 1 FROM billing_renewal_intents i WHERE i.tenant_id=NEW.tenant_id AND i.order_id=NEW.id) THEN
    RAISE EXCEPTION 'Renewal order requires a bound method and paid term';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER renewal_order_intent_guard AFTER INSERT ON billing_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_renewal_intent();
