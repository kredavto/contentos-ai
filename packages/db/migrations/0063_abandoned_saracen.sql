CREATE TABLE "youtube_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"ticket" text NOT NULL,
	"expected_revision" integer NOT NULL,
	"source" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "youtube_resolution_job_uq" UNIQUE("job_id"),
	CONSTRAINT "youtube_resolution_intent_uq" UNIQUE("actor_id","request_key"),
	CONSTRAINT "youtube_resolution_valid" CHECK ("youtube_resolutions"."expected_revision">=0 and "youtube_resolutions"."source" in ('API','DEMO') and "youtube_resolutions"."ticket" ~ '^[A-Za-z0-9_-]{3,80}$' and "youtube_resolutions"."input_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "youtube_resolutions" ADD CONSTRAINT "youtube_resolutions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_resolutions" ADD CONSTRAINT "youtube_resolutions_tenant_id_job_id_publishing_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."publishing_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_resolutions" ADD CONSTRAINT "youtube_resolutions_tenant_id_publication_id_publications_tenant_id_id_fk" FOREIGN KEY ("tenant_id","publication_id") REFERENCES "public"."publications"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION contentos_protect_youtube_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'YouTube resolution evidence is immutable' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER youtube_resolution_immutable BEFORE UPDATE OR DELETE ON youtube_resolutions FOR EACH ROW EXECUTE FUNCTION contentos_protect_youtube_resolution();
