CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"email_enabled" boolean DEFAULT false NOT NULL,
	"revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"enabled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_recipient_uq" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "notification_preferences_enabled_valid" CHECK ("notification_preferences"."email_enabled"=("notification_preferences"."enabled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_user_id_organization_members_tenant_id_user_id_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."organization_members"("tenant_id","user_id") ON DELETE cascade ON UPDATE no action;