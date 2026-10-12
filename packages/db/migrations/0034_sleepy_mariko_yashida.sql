CREATE TABLE "agency_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_organization_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"intent_hash" text NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_clients_distinct_organizations" CHECK ("agency_clients"."tenant_id" <> "agency_clients"."client_organization_id")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_revision_valid" CHECK ("feature_flags"."revision" > 0),
	CONSTRAINT "feature_flags_name_valid" CHECK ("feature_flags"."name" in ('agency_mode','avatar_generation','autopublishing','auto_reply','analytics_ai','trend_radar','broll_generation'))
);
--> statement-breakpoint
ALTER TABLE "agency_clients" ADD CONSTRAINT "agency_clients_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_clients" ADD CONSTRAINT "agency_clients_client_organization_id_organizations_id_fk" FOREIGN KEY ("client_organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_clients" ADD CONSTRAINT "agency_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_clients_tenant_request_uq" ON "agency_clients" USING btree ("tenant_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_clients_tenant_client_uq" ON "agency_clients" USING btree ("tenant_id","client_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_tenant_name_uq" ON "feature_flags" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE FUNCTION protect_agency_client_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.tenant_id, NEW.client_organization_id, NEW.created_by, NEW.request_key, NEW.intent_hash, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.tenant_id, OLD.client_organization_id, OLD.created_by, OLD.request_key, OLD.intent_hash, OLD.created_at) THEN
    RAISE EXCEPTION 'Agency client identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER agency_client_identity_guard BEFORE UPDATE ON agency_clients FOR EACH ROW EXECUTE FUNCTION protect_agency_client_identity();
