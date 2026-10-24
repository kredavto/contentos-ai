CREATE TABLE "comment_import_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"cursor_hash" text NOT NULL,
	"ordinal" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_page_cursor_uq" UNIQUE("tenant_id","import_id","scope","cursor_hash"),
	CONSTRAINT "comment_page_ordinal_uq" UNIQUE("tenant_id","import_id","ordinal"),
	CONSTRAINT "comment_page_valid" CHECK ("comment_import_pages"."ordinal">0 and "comment_import_pages"."cursor_hash" ~ '^[a-f0-9]{64}$' and ("comment_import_pages"."scope"='THREADS' or "comment_import_pages"."scope" ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'))
);
--> statement-breakpoint
CREATE TABLE "comment_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"credential_version" integer NOT NULL,
	"video_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"position" jsonb DEFAULT '{"kind":"THREADS","cursor":null}'::jsonb,
	"remaining_pages" integer DEFAULT 200 NOT NULL,
	"completed_pages" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatch_after" timestamp with time zone DEFAULT now() NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "comment_import_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "comment_import_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "comment_import_identity_valid" CHECK ("comment_imports"."credential_version">0 and "comment_imports"."video_id" ~ '^[A-Za-z0-9_-]{11}$' and "comment_imports"."channel_id" ~ '^UC[A-Za-z0-9_-]{22}$'),
	CONSTRAINT "comment_import_counters_valid" CHECK ("comment_imports"."remaining_pages" between 0 and 200 and "comment_imports"."completed_pages">=0 and "comment_imports"."revision">=0 and "comment_imports"."attempt" between 0 and 3),
	CONSTRAINT "comment_import_state_valid" CHECK ("comment_imports"."status" in ('QUEUED','RUNNING','PARTIAL','SUCCEEDED','FAILED','CANCELLED') and (("comment_imports"."status"='SUCCEEDED' and "comment_imports"."position" is null) or ("comment_imports"."status"<>'SUCCEEDED' and "comment_imports"."position" is not null and jsonb_typeof("comment_imports"."position")='object')) and ("comment_imports"."status" not in ('QUEUED','RUNNING') or "comment_imports"."remaining_pages">0) and ("comment_imports"."status"<>'PARTIAL' or "comment_imports"."remaining_pages"=0)),
	CONSTRAINT "comment_import_lease_valid" CHECK ((("comment_imports"."status"='RUNNING' and "comment_imports"."lease_token" is not null and "comment_imports"."lease_expires_at" is not null and "comment_imports"."started_at" is not null) or ("comment_imports"."status"<>'RUNNING' and "comment_imports"."lease_token" is null and "comment_imports"."lease_expires_at" is null))),
	CONSTRAINT "comment_import_finish_valid" CHECK ((("comment_imports"."status" in ('SUCCEEDED','FAILED','CANCELLED') and "comment_imports"."finished_at" is not null) or ("comment_imports"."status" not in ('SUCCEEDED','FAILED','CANCELLED') and "comment_imports"."finished_at" is null)))
);
--> statement-breakpoint
ALTER TABLE "comment_import_pages" ADD CONSTRAINT "comment_page_import_fk" FOREIGN KEY ("tenant_id","import_id") REFERENCES "public"."comment_imports"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_imports" ADD CONSTRAINT "comment_imports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_imports" ADD CONSTRAINT "comment_import_brand_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_imports" ADD CONSTRAINT "comment_import_publication_fk" FOREIGN KEY ("tenant_id","publication_id") REFERENCES "public"."publications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_imports" ADD CONSTRAINT "comment_import_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_import_active_uq" ON "comment_imports" USING btree ("tenant_id","publication_id") WHERE "comment_imports"."status" in ('QUEUED','RUNNING','PARTIAL');--> statement-breakpoint
CREATE INDEX "comment_import_due_idx" ON "comment_imports" USING btree ("status","next_attempt_at","dispatch_after");--> statement-breakpoint
CREATE INDEX "comment_import_history_idx" ON "comment_imports" USING btree ("tenant_id","publication_id","created_at","id");