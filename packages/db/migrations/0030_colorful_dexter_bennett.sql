CREATE TABLE "notification_receipts" (
	"source_key" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"type" text NOT NULL,
	"audience" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"brand_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "notification_recipient_source_uq" UNIQUE("tenant_id","user_id","source_key","type"),
	CONSTRAINT "notification_type_valid" CHECK ("notifications"."type" in ('VIDEO_READY','CONTENT_APPROVAL_REQUIRED','PUBLICATION_SUCCESS','PUBLICATION_FAILED','PAYMENT_SUCCESS','PAYMENT_FAILED','SUBSCRIPTION_EXPIRING','SOCIAL_TOKEN_EXPIRED','JOB_FAILED')),
	CONSTRAINT "notification_audience_valid" CHECK ("notifications"."audience" in ('ALL','OWNERS','EDITORS','APPROVERS','MANAGERS'))
);
--> statement-breakpoint
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_user_id_organization_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."organization_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_inbox_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at");--> statement-breakpoint
CREATE TRIGGER notification_receipts_append_only BEFORE UPDATE OR DELETE ON notification_receipts FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE FUNCTION guard_notification_read() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'read_at') IS DISTINCT FROM (to_jsonb(OLD)-'read_at') OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
    THEN RAISE EXCEPTION 'Notification identity and first read are immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER notification_read_guard BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION guard_notification_read();
