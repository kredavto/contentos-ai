CREATE TABLE "youtube_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"phase" text DEFAULT 'STARTING' NOT NULL,
	"session" jsonb,
	"source_etag" text NOT NULL,
	"total_bytes" integer NOT NULL,
	"next_byte" integer DEFAULT 0 NOT NULL,
	"channel_id" text NOT NULL,
	"video_id" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_upload_job_uq" UNIQUE("job_id"),
	CONSTRAINT "youtube_upload_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "youtube_upload_bounds" CHECK ("youtube_uploads"."total_bytes" between 1 and 268435456 and "youtube_uploads"."next_byte" between 0 and "youtube_uploads"."total_bytes" and "youtube_uploads"."retry_count" between 0 and 8 and "youtube_uploads"."revision" >= 0),
	CONSTRAINT "youtube_upload_identity" CHECK ("youtube_uploads"."channel_id" ~ '^UC[A-Za-z0-9_-]{22}$' and "youtube_uploads"."source_etag" ~ '^"[A-Za-z0-9_-]{1,128}"$' and ("youtube_uploads"."video_id" is null or "youtube_uploads"."video_id" ~ '^[A-Za-z0-9_-]{11}$')),
	CONSTRAINT "youtube_upload_phase" CHECK (("youtube_uploads"."phase"='STARTING' and "youtube_uploads"."session" is null and "youtube_uploads"."video_id" is null and "youtube_uploads"."next_byte"=0) or ("youtube_uploads"."phase"='UPLOADING' and "youtube_uploads"."session" is not null and "youtube_uploads"."video_id" is null) or ("youtube_uploads"."phase" in ('PROCESSING','THUMBNAIL','VERIFYING') and "youtube_uploads"."session" is not null and "youtube_uploads"."video_id" is not null and "youtube_uploads"."next_byte"="youtube_uploads"."total_bytes") or ("youtube_uploads"."phase"='COMPLETE' and "youtube_uploads"."session" is null and "youtube_uploads"."video_id" is not null and "youtube_uploads"."next_byte"="youtube_uploads"."total_bytes"))
);
--> statement-breakpoint
ALTER TABLE "youtube_uploads" ADD CONSTRAINT "youtube_uploads_tenant_id_job_id_publishing_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."publishing_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION contentos_protect_youtube_upload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'YouTube upload evidence cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.id,NEW.tenant_id,NEW.job_id,NEW.source_etag,NEW.total_bytes,NEW.channel_id,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.job_id,OLD.source_etag,OLD.total_bytes,OLD.channel_id,OLD.created_at)
     OR NEW.next_byte < OLD.next_byte
     OR (OLD.video_id IS NOT NULL AND NEW.video_id IS DISTINCT FROM OLD.video_id)
     OR (OLD.phase='COMPLETE' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'YouTube upload identity and acknowledged progress are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER youtube_upload_evidence_immutable BEFORE UPDATE OR DELETE ON youtube_uploads FOR EACH ROW EXECUTE FUNCTION contentos_protect_youtube_upload();
