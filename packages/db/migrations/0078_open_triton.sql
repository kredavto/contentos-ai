ALTER TABLE "avatars" ADD COLUMN "provider_key_id" uuid;--> statement-breakpoint
ALTER TABLE "avatars" ADD COLUMN "provider_key_revision" integer;--> statement-breakpoint
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_key_brand_identity_uq" UNIQUE("tenant_id","brand_id","id","provider");--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatar_provider_key_scope_fk" FOREIGN KEY ("tenant_id","brand_id","provider_key_id","provider") REFERENCES "public"."provider_keys"("tenant_id","brand_id","id","provider") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatar_provider_key_binding_valid" CHECK (("avatars"."provider_key_id" is null and "avatars"."provider_key_revision" is null) or ("avatars"."provider_key_id" is not null and "avatars"."provider_key_revision" is not null and "avatars"."provider_key_revision">=0 and "avatars"."provider"='heygen'));
--> statement-breakpoint
CREATE FUNCTION guard_avatar_provider_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.tenant_id,NEW.brand_id,NEW.provider,NEW.provider_key_id,NEW.provider_key_revision) IS DISTINCT FROM (OLD.tenant_id,OLD.brand_id,OLD.provider,OLD.provider_key_id,OLD.provider_key_revision)
 THEN RAISE EXCEPTION 'Avatar provider binding is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER avatar_provider_binding_guard BEFORE UPDATE ON avatars FOR EACH ROW EXECUTE FUNCTION guard_avatar_provider_binding();
