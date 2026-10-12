CREATE TABLE "billing_renewal_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"consent_id" uuid,
	"revision" integer NOT NULL,
	"operation" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewal_change_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "renewal_change_revision_uq" UNIQUE("tenant_id","revision"),
	CONSTRAINT "renewal_change_valid" CHECK ("billing_renewal_changes"."revision" > 0 and "billing_renewal_changes"."operation" in ('ENABLE','DISABLE') and ("billing_renewal_changes"."operation" <> 'ENABLE' or "billing_renewal_changes"."consent_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "billing_renewal_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"policy_text" text NOT NULL,
	"text_hash" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"accepted_by" uuid NOT NULL,
	"ip_address" text NOT NULL,
	"user_agent" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewal_consent_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "renewal_consent_amount_valid" CHECK ("billing_renewal_consents"."amount_minor" > 0 and "billing_renewal_consents"."currency" = 'RUB' and "billing_renewal_consents"."text_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "billing_renewal_preferences" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"active_consent_id" uuid,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renewal_revision_valid" CHECK ("billing_renewal_preferences"."revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billing_renewal_changes" ADD CONSTRAINT "billing_renewal_changes_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_renewal_changes" ADD CONSTRAINT "billing_renewal_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_renewal_changes" ADD CONSTRAINT "billing_renewal_changes_tenant_id_consent_id_billing_renewal_consents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","consent_id") REFERENCES "public"."billing_renewal_consents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_renewal_consents" ADD CONSTRAINT "billing_renewal_consents_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_renewal_consents" ADD CONSTRAINT "billing_renewal_consents_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_renewal_consents" ADD CONSTRAINT "billing_renewal_consents_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_renewal_preferences" ADD CONSTRAINT "billing_renewal_preferences_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_renewal_preferences" ADD CONSTRAINT "billing_renewal_preferences_tenant_id_active_consent_id_billing_renewal_consents_tenant_id_id_fk" FOREIGN KEY ("tenant_id","active_consent_id") REFERENCES "public"."billing_renewal_consents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE TRIGGER renewal_consents_append_only BEFORE UPDATE OR DELETE ON billing_renewal_consents FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER renewal_changes_append_only BEFORE UPDATE OR DELETE ON billing_renewal_changes FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION contentos_validate_renewal_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM plan_versions WHERE id=NEW.plan_version_id AND amount_minor=NEW.amount_minor AND currency=NEW.currency)
  THEN RAISE EXCEPTION 'Renewal consent price does not match plan'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER renewal_consent_price_guard BEFORE INSERT ON billing_renewal_consents FOR EACH ROW EXECUTE FUNCTION contentos_validate_renewal_consent();
