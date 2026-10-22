ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_tenant_id_uq" UNIQUE("tenant_id","id");
--> statement-breakpoint
CREATE TABLE "approval_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_comment_intent_uq" UNIQUE("tenant_id","request_id","user_id","idempotency_key"),
	CONSTRAINT "approval_comment_body_valid" CHECK (length(trim("approval_comments"."body")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_comments" ADD CONSTRAINT "approval_comments_tenant_id_request_id_approval_requests_tenant_id_id_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."approval_requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_comment_request_idx" ON "approval_comments" USING btree ("tenant_id","request_id","created_at","id");--> statement-breakpoint

--> statement-breakpoint
CREATE FUNCTION contentos_protect_approval_comment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Approval comments are immutable' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER approval_comment_immutable BEFORE UPDATE OR DELETE ON approval_comments FOR EACH ROW EXECUTE FUNCTION contentos_protect_approval_comment();
