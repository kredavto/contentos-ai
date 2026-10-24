ALTER TABLE "approval_requests" DROP CONSTRAINT "approval_valid";--> statement-breakpoint
ALTER TABLE "approval_requests" ALTER COLUMN "script_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "post_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "carousel_id" uuid;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "lifecycle_revision" integer;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_post_id_posts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","post_id") REFERENCES "public"."posts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_post_id_version_content_versions_post_id_version_fk" FOREIGN KEY ("post_id","version") REFERENCES "public"."content_versions"("post_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_carousel_id_carousels_tenant_id_id_fk" FOREIGN KEY ("tenant_id","carousel_id") REFERENCES "public"."carousels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_carousel_id_version_carousel_versions_carousel_id_version_fk" FOREIGN KEY ("carousel_id","version") REFERENCES "public"."carousel_versions"("carousel_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_pending_post_uq" ON "approval_requests" USING btree ("tenant_id","post_id") WHERE "approval_requests"."status"='PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "approval_pending_carousel_uq" ON "approval_requests" USING btree ("tenant_id","carousel_id") WHERE "approval_requests"."status"='PENDING';--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_target_valid" CHECK ((("approval_requests"."entity_type"='SCRIPT' and "approval_requests"."script_id" is not null and "approval_requests"."post_id" is null and "approval_requests"."carousel_id" is null and "approval_requests"."lifecycle_revision" is null) or ("approval_requests"."entity_type"='POST' and "approval_requests"."script_id" is null and "approval_requests"."post_id" is not null and "approval_requests"."carousel_id" is null and "approval_requests"."lifecycle_revision" is null) or ("approval_requests"."entity_type"='CAROUSEL' and "approval_requests"."script_id" is null and "approval_requests"."post_id" is null and "approval_requests"."carousel_id" is not null and "approval_requests"."lifecycle_revision" is not null and "approval_requests"."lifecycle_revision">=0)));--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_valid" CHECK ("approval_requests"."version">0 and length("approval_requests"."request_comment")<=2000 and length(coalesce("approval_requests"."comment",''))<=2000 and "approval_requests"."input_hash" ~ '^[a-f0-9]{64}$' and "approval_requests"."status" in ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED') and (("approval_requests"."status"='PENDING' and "approval_requests"."resolved_by" is null and "approval_requests"."resolved_at" is null and "approval_requests"."comment" is null) or ("approval_requests"."status"<>'PENDING' and "approval_requests"."resolved_by" is not null and "approval_requests"."resolved_at" is not null and "approval_requests"."comment" is not null)));--> statement-breakpoint
CREATE OR REPLACE FUNCTION contentos_protect_approval_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'PENDING' OR NOT (
      (NEW.entity_type='SCRIPT' AND EXISTS (SELECT 1 FROM scripts WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.script_id)) OR
      (NEW.entity_type='POST' AND EXISTS (SELECT 1 FROM posts WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.post_id)) OR
      (NEW.entity_type='CAROUSEL' AND EXISTS (SELECT 1 FROM carousels WHERE tenant_id=NEW.tenant_id AND brand_id=NEW.brand_id AND id=NEW.carousel_id))
    ) THEN RAISE EXCEPTION 'Invalid approval target or initial state' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Approval evidence cannot be deleted' USING ERRCODE='23514'; END IF;
  IF OLD.status <> 'PENDING' OR
    (NEW.id,NEW.tenant_id,NEW.brand_id,NEW.entity_type,NEW.script_id,NEW.post_id,NEW.carousel_id,NEW.lifecycle_revision,NEW.version,NEW.requested_by,NEW.requested_from,NEW.request_comment,NEW.idempotency_key,NEW.input_hash,NEW.created_at)
      IS DISTINCT FROM
    (OLD.id,OLD.tenant_id,OLD.brand_id,OLD.entity_type,OLD.script_id,OLD.post_id,OLD.carousel_id,OLD.lifecycle_revision,OLD.version,OLD.requested_by,OLD.requested_from,OLD.request_comment,OLD.idempotency_key,OLD.input_hash,OLD.created_at) THEN
    RAISE EXCEPTION 'Approval identity and terminal evidence are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
