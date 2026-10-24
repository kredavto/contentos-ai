ALTER TABLE "comment_reply_versions" ADD CONSTRAINT "comment_reply_version_scope_uq" UNIQUE("tenant_id","publication_id","comment_id","draft_id","version");
--> statement-breakpoint
CREATE TABLE "comment_reply_approval_revocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"revoked_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_approval_revocation_uq" UNIQUE("tenant_id","approval_id")
);
--> statement-breakpoint
CREATE TABLE "comment_reply_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"draft_revision" integer NOT NULL,
	"connection_id" uuid NOT NULL,
	"binding" jsonb NOT NULL,
	"approved_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_approval_tenant_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "reply_approval_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "reply_approval_valid" CHECK ("comment_reply_approvals"."version">0 and "comment_reply_approvals"."draft_revision">=0 and "comment_reply_approvals"."input_hash" ~ '^[a-f0-9]{64}$' and jsonb_typeof("comment_reply_approvals"."binding")='object' and coalesce("comment_reply_approvals"."binding"->>'connectionId','')="comment_reply_approvals"."connection_id"::text)
);
--> statement-breakpoint
ALTER TABLE "comment_reply_approval_revocations" ADD CONSTRAINT "comment_reply_approval_revocations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reply_approval_revocations" ADD CONSTRAINT "reply_approval_revocation_fk" FOREIGN KEY ("tenant_id","approval_id") REFERENCES "public"."comment_reply_approvals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reply_approvals" ADD CONSTRAINT "comment_reply_approvals_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reply_approvals" ADD CONSTRAINT "reply_approval_version_fk" FOREIGN KEY ("tenant_id","publication_id","comment_id","draft_id","version") REFERENCES "public"."comment_reply_versions"("tenant_id","publication_id","comment_id","draft_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reply_approvals" ADD CONSTRAINT "reply_approval_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reply_approval_comment_idx" ON "comment_reply_approvals" USING btree ("tenant_id","comment_id","created_at","id");--> statement-breakpoint

CREATE TRIGGER reply_approval_immutable BEFORE UPDATE OR DELETE ON comment_reply_approvals FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER reply_approval_revocation_immutable BEFORE UPDATE OR DELETE ON comment_reply_approval_revocations FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
