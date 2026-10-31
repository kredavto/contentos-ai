CREATE TABLE "billing_payment_methods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"consent_id" uuid NOT NULL,
	"renewal_revision" integer NOT NULL,
	"credential" jsonb,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_method_order_uq" UNIQUE("tenant_id","order_id"),
	CONSTRAINT "payment_method_identity_valid" CHECK ("billing_payment_methods"."id" = "billing_payment_methods"."order_id" and "billing_payment_methods"."renewal_revision" > 0),
	CONSTRAINT "payment_method_revocation_valid" CHECK (("billing_payment_methods"."revoked_at" is null and "billing_payment_methods"."credential" is not null) or ("billing_payment_methods"."revoked_at" is not null and "billing_payment_methods"."credential" is null))
);
--> statement-breakpoint
ALTER TABLE "billing_orders" ADD COLUMN "renewal_consent_id" uuid;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD COLUMN "renewal_revision" integer;--> statement-breakpoint
ALTER TABLE "billing_payment_methods" ADD CONSTRAINT "billing_payment_methods_tenant_id_order_id_payment_settlements_tenant_id_order_id_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."payment_settlements"("tenant_id","order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_payment_methods" ADD CONSTRAINT "billing_payment_methods_tenant_id_consent_id_billing_renewal_consents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","consent_id") REFERENCES "public"."billing_renewal_consents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_tenant_id_renewal_consent_id_billing_renewal_consents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","renewal_consent_id") REFERENCES "public"."billing_renewal_consents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_order_renewal_valid" CHECK ((("billing_orders"."renewal_consent_id" is null and "billing_orders"."renewal_revision" is null and "billing_orders"."input"->>'saveMethod' = 'false') or ("billing_orders"."renewal_consent_id" is not null and "billing_orders"."renewal_revision" > 0 and ("billing_orders"."input"->>'saveMethod' = 'true' or "billing_orders"."input"->>'mode' = 'RENEWAL'))) IS TRUE);--> statement-breakpoint
CREATE FUNCTION contentos_validate_order_renewal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.renewal_consent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM billing_renewal_consents c JOIN billing_renewal_preferences p ON p.tenant_id=c.tenant_id AND p.active_consent_id=c.id
    WHERE c.tenant_id=NEW.tenant_id AND c.id=NEW.renewal_consent_id AND p.revision=NEW.renewal_revision
      AND c.plan_version_id=NEW.plan_version_id AND c.amount_minor=NEW.amount_minor AND c.currency=NEW.currency
  ) THEN RAISE EXCEPTION 'Active price-bound renewal consent required'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER billing_order_renewal_guard BEFORE INSERT ON billing_orders FOR EACH ROW EXECUTE FUNCTION contentos_validate_order_renewal();
--> statement-breakpoint
CREATE FUNCTION contentos_preserve_payment_method() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.id,NEW.tenant_id,NEW.order_id,NEW.consent_id,NEW.renewal_revision,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.order_id,OLD.consent_id,OLD.renewal_revision,OLD.created_at)
      OR (OLD.revoked_at IS NOT NULL AND ROW(NEW.credential,NEW.revoked_at) IS DISTINCT FROM ROW(OLD.credential,OLD.revoked_at))
    THEN RAISE EXCEPTION 'Payment method identity and revocation are immutable'; END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM billing_orders o JOIN billing_renewal_preferences p ON p.tenant_id=o.tenant_id
      WHERE o.tenant_id=NEW.tenant_id AND o.id=NEW.order_id AND o.renewal_consent_id=NEW.consent_id
        AND o.renewal_revision=NEW.renewal_revision AND p.active_consent_id=NEW.consent_id AND p.revision=NEW.renewal_revision
    ) THEN RAISE EXCEPTION 'Payment method mandate is not active'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_method_identity_guard BEFORE INSERT OR UPDATE ON billing_payment_methods FOR EACH ROW EXECUTE FUNCTION contentos_preserve_payment_method();
