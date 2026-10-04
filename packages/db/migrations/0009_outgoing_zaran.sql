CREATE TABLE "video_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"script_id" uuid NOT NULL,
	"script_version" integer NOT NULL,
	"look_id" uuid NOT NULL,
	"voice_id" uuid NOT NULL,
	"script_text" text NOT NULL,
	"title" text NOT NULL,
	"platform" text NOT NULL,
	"planned_duration" integer NOT NULL,
	"avatar_reference" jsonb NOT NULL,
	"voice_reference" jsonb NOT NULL,
	"consent" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"max_duration_seconds" integer NOT NULL,
	"stage" text DEFAULT 'VIDEO_REQUESTED' NOT NULL,
	"stage_revision" integer DEFAULT 0 NOT NULL,
	"provider" text NOT NULL,
	"reference" jsonb,
	"first_submitted_at" timestamp with time zone,
	"mutation_state" text DEFAULT 'NONE' NOT NULL,
	"original_key" text NOT NULL,
	"final_key" text NOT NULL,
	"cover_key" text NOT NULL,
	"duration_ms" integer,
	"final_bytes" integer,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "video_job_uq" UNIQUE("job_id"),
	CONSTRAINT "video_stage_valid" CHECK ("video_projects"."stage" in ('VIDEO_REQUESTED','VOICE_PREPARING','AVATAR_RENDERING','POST_PROCESSING','CAPTIONS_GENERATING','BROLL_PROCESSING','COVER_GENERATING','QC','READY','FAILED')),
	CONSTRAINT "video_budget_valid" CHECK ("video_projects"."max_duration_seconds" between 1 and 180),
	CONSTRAINT "video_mutation_valid" CHECK ("video_projects"."mutation_state" in ('NONE','STARTED','UNKNOWN','ACCEPTED','REJECTED'))
);
--> statement-breakpoint
CREATE TABLE "video_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_transition_revision_uq" UNIQUE("project_id","revision")
);
--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_tenant_id_job_id_jobs_tenant_id_id_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_tenant_id_script_id_scripts_tenant_id_id_fk" FOREIGN KEY ("tenant_id","script_id") REFERENCES "public"."scripts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_tenant_id_look_id_avatar_looks_tenant_id_id_fk" FOREIGN KEY ("tenant_id","look_id") REFERENCES "public"."avatar_looks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_tenant_id_voice_id_voice_profiles_tenant_id_id_fk" FOREIGN KEY ("tenant_id","voice_id") REFERENCES "public"."voice_profiles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_transitions" ADD CONSTRAINT "video_transitions_tenant_id_project_id_video_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."video_projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_brand_idx" ON "video_projects" USING btree ("tenant_id","brand_id");
--> statement-breakpoint
CREATE TRIGGER video_transitions_immutable BEFORE UPDATE OR DELETE ON video_transitions FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
