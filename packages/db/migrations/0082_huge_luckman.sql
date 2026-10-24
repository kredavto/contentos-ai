CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_comment_id" text NOT NULL,
	"external_thread_id" text NOT NULL,
	"parent_id" uuid,
	"external_author_id" text,
	"author_name" text,
	"text" text NOT NULL,
	"provider_created_at" timestamp with time zone NOT NULL,
	"provider_updated_at" timestamp with time zone NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"reply_count" integer,
	"can_reply" boolean,
	"is_public" boolean,
	"content_revision" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"sentiment" text,
	"status" text DEFAULT 'NEW' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "comment_external_identity_uq" UNIQUE("tenant_id","publication_id","provider","external_comment_id"),
	CONSTRAINT "comment_thread_identity_uq" UNIQUE("tenant_id","publication_id","provider","external_thread_id","id"),
	CONSTRAINT "comment_identity_valid" CHECK ("comments"."provider"='youtube' and "comments"."external_comment_id" ~ '^[A-Za-z0-9_.-]{1,256}$' and "comments"."external_thread_id" ~ '^[A-Za-z0-9_.-]{1,256}$' and ("comments"."parent_id" is null or "comments"."parent_id"<>"comments"."id")),
	CONSTRAINT "comment_content_valid" CHECK (length("comments"."text")<=10000 and ("comments"."author_name" is null or length("comments"."author_name")<=1000) and ("comments"."external_author_id" is null or "comments"."external_author_id" ~ '^UC[A-Za-z0-9_-]{22}$')),
	CONSTRAINT "comment_time_valid" CHECK ("comments"."provider_updated_at">="comments"."provider_created_at" and "comments"."last_observed_at">="comments"."first_observed_at"),
	CONSTRAINT "comment_thread_valid" CHECK ((("comments"."parent_id" is null and "comments"."reply_count" is not null and "comments"."reply_count">=0 and "comments"."can_reply" is not null and "comments"."is_public" is not null) or ("comments"."parent_id" is not null and "comments"."reply_count" is null and "comments"."can_reply" is null and "comments"."is_public" is null))),
	CONSTRAINT "comment_review_valid" CHECK ("comments"."content_revision">=0 and "comments"."revision">=0 and "comments"."status" in ('NEW','NEEDS_HUMAN','RESOLVED') and ("comments"."sentiment" is null or "comments"."sentiment" in ('POSITIVE','NEUTRAL','NEGATIVE')))
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comment_publication_fk" FOREIGN KEY ("tenant_id","publication_id") REFERENCES "public"."publications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comment_parent_thread_fk" FOREIGN KEY ("tenant_id","publication_id","provider","external_thread_id","parent_id") REFERENCES "public"."comments"("tenant_id","publication_id","provider","external_thread_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_inbox_idx" ON "comments" USING btree ("tenant_id","publication_id","status","provider_created_at","id");--> statement-breakpoint
CREATE INDEX "comment_parent_idx" ON "comments" USING btree ("tenant_id","publication_id","parent_id","provider_created_at","id");