CREATE TABLE "provider_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"credential" jsonb,
	"masked_key" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_key_scope_uq" UNIQUE("tenant_id","brand_id","provider"),
	CONSTRAINT "provider_key_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "provider_key_provider_valid" CHECK ("provider_keys"."provider" in ('heygen','openai')),
	CONSTRAINT "provider_key_status_valid" CHECK ("provider_keys"."status" in ('ACTIVE','REVOKED') and ("provider_keys"."status"='ACTIVE')=("provider_keys"."credential" is not null)),
	CONSTRAINT "provider_key_revision_valid" CHECK ("provider_keys"."revision">=0),
	CONSTRAINT "provider_key_mask_valid" CHECK (length("provider_keys"."masked_key")=12 and left("provider_keys"."masked_key",8)='••••••••')
);
--> statement-breakpoint
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION guard_provider_key_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.tenant_id,NEW.brand_id,NEW.provider,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.brand_id,OLD.provider,OLD.created_by,OLD.created_at) OR NEW.revision<=OLD.revision
 THEN RAISE EXCEPTION 'Provider key identity is immutable and revisions must advance'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_key_identity_guard BEFORE UPDATE ON provider_keys FOR EACH ROW EXECUTE FUNCTION guard_provider_key_identity();
