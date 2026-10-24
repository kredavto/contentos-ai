ALTER TABLE "video_projects" ADD COLUMN "provider_key_id" uuid;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "provider_key_revision" integer;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_provider_key_scope_fk" FOREIGN KEY ("tenant_id","brand_id","provider_key_id","provider") REFERENCES "public"."provider_keys"("tenant_id","brand_id","id","provider") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_provider_key_binding_valid" CHECK (("video_projects"."provider_key_id" is null and "video_projects"."provider_key_revision" is null) or ("video_projects"."provider_key_id" is not null and "video_projects"."provider_key_revision" is not null and "video_projects"."provider_key_revision">=0 and "video_projects"."provider"='heygen'));
--> statement-breakpoint
CREATE FUNCTION guard_video_provider_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.tenant_id,NEW.brand_id,NEW.provider,NEW.look_id,NEW.provider_key_id,NEW.provider_key_revision) IS DISTINCT FROM (OLD.tenant_id,OLD.brand_id,OLD.provider,OLD.look_id,OLD.provider_key_id,OLD.provider_key_revision)
 THEN RAISE EXCEPTION 'Video provider binding is immutable'; END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER video_provider_binding_guard BEFORE UPDATE ON video_projects FOR EACH ROW EXECUTE FUNCTION guard_video_provider_binding();
