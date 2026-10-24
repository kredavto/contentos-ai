ALTER TABLE "comments" ADD CONSTRAINT "comment_publication_identity_uq" UNIQUE("tenant_id","publication_id","id");
--> statement-breakpoint
CREATE TABLE "comment_reply_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reply_draft_tenant_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "comment_reply_draft_comment_uq" UNIQUE("tenant_id","comment_id"),
	CONSTRAINT "comment_reply_draft_scope_uq" UNIQUE("tenant_id","publication_id","comment_id","id"),
	CONSTRAINT "comment_reply_draft_revision_valid" CHECK ("comment_reply_drafts"."current_version">0 and "comment_reply_drafts"."revision">=0)
);
--> statement-breakpoint
CREATE TABLE "comment_reply_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"input" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"job_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reply_version_tenant_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "comment_reply_version_number_uq" UNIQUE("tenant_id","draft_id","version"),
	CONSTRAINT "comment_reply_version_job_uq" UNIQUE("job_id"),
	CONSTRAINT "comment_reply_version_source_valid" CHECK ("comment_reply_versions"."version">0 and (("comment_reply_versions"."source"='AI' and "comment_reply_versions"."job_id" is not null) or ("comment_reply_versions"."source"='HUMAN' and "comment_reply_versions"."job_id" is null))),
	CONSTRAINT "comment_reply_version_input_valid" CHECK (jsonb_typeof("comment_reply_versions"."input")='object' and coalesce("comment_reply_versions"."input"->'comment'->>'id','')="comment_reply_versions"."comment_id"::text and coalesce(jsonb_typeof("comment_reply_versions"."input"->'comment'->'contentRevision'),'')='number' and coalesce(jsonb_typeof("comment_reply_versions"."input"->'comment'->'reviewRevision'),'')='number'),
	CONSTRAINT "comment_reply_version_content_valid" CHECK (jsonb_typeof("comment_reply_versions"."content")='object' and "comment_reply_versions"."content" ? 'reply' and ("comment_reply_versions"."content"->'reply'='null'::jsonb or (jsonb_typeof("comment_reply_versions"."content"->'reply')='string' and length("comment_reply_versions"."content"->>'reply') between 1 and 2000)) and coalesce(jsonb_typeof("comment_reply_versions"."content"->'risks'),'')='array' and jsonb_array_length("comment_reply_versions"."content"->'risks')<=8)
);
--> statement-breakpoint
ALTER TABLE "comment_reply_drafts" ADD CONSTRAINT "comment_reply_draft_comment_fk" FOREIGN KEY ("tenant_id","publication_id","comment_id") REFERENCES "public"."comments"("tenant_id","publication_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reply_versions" ADD CONSTRAINT "comment_reply_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reply_versions" ADD CONSTRAINT "comment_reply_version_draft_fk" FOREIGN KEY ("tenant_id","publication_id","comment_id","draft_id") REFERENCES "public"."comment_reply_drafts"("tenant_id","publication_id","comment_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reply_versions" ADD CONSTRAINT "comment_reply_version_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_reply_draft_publication_idx" ON "comment_reply_drafts" USING btree ("tenant_id","publication_id","updated_at","id");--> statement-breakpoint
