CREATE TABLE "platform_plan_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean NOT NULL,
	"ticket" text NOT NULL,
	"request_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_plan_change_valid" CHECK ("platform_plan_changes"."ticket" ~ '^[A-Za-z0-9_-]{3,80}$' and "platform_plan_changes"."input_hash" ~ '^[a-f0-9]{64}$' and length("platform_plan_changes"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "platform_plan_changes" ADD CONSTRAINT "platform_plan_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_plan_changes" ADD CONSTRAINT "platform_plan_changes_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_plan_change_intent_uq" ON "platform_plan_changes" USING btree ("actor_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_plan_change_version_uq" ON "platform_plan_changes" USING btree ("plan_version_id");--> statement-breakpoint
CREATE TRIGGER platform_plan_changes_append_only BEFORE UPDATE OR DELETE ON platform_plan_changes FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
