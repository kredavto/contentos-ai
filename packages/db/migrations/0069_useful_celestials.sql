ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_target_valid";--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "video_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "cover_revision" integer;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_video_id_video_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","video_id") REFERENCES "public"."video_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_pending_video_uq" ON "approval_requests" USING btree ("tenant_id","video_id") WHERE "approval_requests"."status"='PENDING';--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_target_valid" CHECK ((((((("approval_requests"."entity_type"='SCRIPT' and "approval_requests"."script_id" is not null and "approval_requests"."post_id" is null and "approval_requests"."carousel_id" is null and "approval_requests"."lifecycle_revision" is null) or ("approval_requests"."entity_type"='POST' and "approval_requests"."script_id" is null and "approval_requests"."post_id" is not null and "approval_requests"."carousel_id" is null and "approval_requests"."lifecycle_revision" is null) or ("approval_requests"."entity_type"='CAROUSEL' and "approval_requests"."script_id" is null and "approval_requests"."post_id" is null and "approval_requests"."carousel_id" is not null and "approval_requests"."lifecycle_revision" is not null and "approval_requests"."lifecycle_revision">=0)) and "approval_requests"."image_id" is null and "approval_requests"."media_hash" is null) or ("approval_requests"."entity_type"='IMAGE' and "approval_requests"."image_id" is not null and "approval_requests"."script_id" is null and "approval_requests"."post_id" is null and "approval_requests"."carousel_id" is null and "approval_requests"."lifecycle_revision" is null and "approval_requests"."version"=1 and "approval_requests"."media_hash" is not null and "approval_requests"."media_hash" ~ '^[a-f0-9]{64}$')) and "approval_requests"."video_id" is null and "approval_requests"."cover_revision" is null) or ("approval_requests"."entity_type"='VIDEO' and "approval_requests"."video_id" is not null and "approval_requests"."cover_revision" is not null and "approval_requests"."cover_revision">=0 and "approval_requests"."script_id" is null and "approval_requests"."post_id" is null and "approval_requests"."carousel_id" is null and "approval_requests"."image_id" is null and "approval_requests"."media_hash" is null and "approval_requests"."lifecycle_revision" is null)));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION contentos_protect_approval_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'PENDING' OR NOT (
      (NEW.entity_type='SCRIPT' AND EXISTS (SELECT 1 FROM scripts WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.script_id)) OR
      (NEW.entity_type='POST' AND EXISTS (SELECT 1 FROM posts WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.post_id)) OR
      (NEW.entity_type='VIDEO' AND EXISTS (SELECT 1 FROM video_projects WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.video_id AND stage='READY' AND lifecycle='ACTIVE' AND stage_revision=NEW.version AND cover_revision=NEW.cover_revision)) OR
      (NEW.entity_type='IMAGE' AND EXISTS (SELECT 1 FROM generated_images WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.image_id AND status='READY' AND sha256=NEW.media_hash)) OR
      (NEW.entity_type='CAROUSEL' AND EXISTS (SELECT 1 FROM carousels WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.carousel_id))
    ) THEN RAISE EXCEPTION 'Invalid approval target or initial state' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Approval evidence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status <> 'PENDING' OR
    (NEW.id,NEW.tenant_id,NEW.brand_id,NEW.entity_type,NEW.script_id,NEW.post_id,NEW.carousel_id,NEW.image_id,NEW.video_id,NEW.cover_revision,NEW.media_hash,NEW.lifecycle_revision,NEW.version,NEW.requested_by,NEW.requested_from,NEW.request_comment,NEW.idempotency_key,NEW.input_hash,NEW.created_at)
      IS DISTINCT FROM
    (OLD.id,OLD.tenant_id,OLD.brand_id,OLD.entity_type,OLD.script_id,OLD.post_id,OLD.carousel_id,OLD.image_id,OLD.video_id,OLD.cover_revision,OLD.media_hash,OLD.lifecycle_revision,OLD.version,OLD.requested_by,OLD.requested_from,OLD.request_comment,OLD.idempotency_key,OLD.input_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'Approval identity and terminal evidence are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
