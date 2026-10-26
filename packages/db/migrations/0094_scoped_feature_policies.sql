CREATE TABLE "feature_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feature" text NOT NULL,
	"scope" text NOT NULL,
	"plan_id" uuid,
	"tenant_id" uuid,
	"user_id" uuid,
	"mode" text DEFAULT 'INHERIT' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"updated_by" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_policy_target_uq" UNIQUE NULLS NOT DISTINCT("feature","scope","plan_id","tenant_id","user_id"),
	CONSTRAINT "feature_policy_feature_valid" CHECK ("feature_policies"."feature" in ('avatar_generation','video_generation','trend_radar','instagram_publishing','tiktok_publishing','youtube_publishing','telegram_publishing','autopilot','comments','analytics_ai','agency_mode','byok')),
	CONSTRAINT "feature_policy_scope_valid" CHECK (("feature_policies"."scope"='GLOBAL' and "feature_policies"."plan_id" is null and "feature_policies"."tenant_id" is null and "feature_policies"."user_id" is null) or ("feature_policies"."scope"='PLAN' and "feature_policies"."plan_id" is not null and "feature_policies"."tenant_id" is null and "feature_policies"."user_id" is null) or ("feature_policies"."scope"='ORGANIZATION' and "feature_policies"."plan_id" is null and "feature_policies"."tenant_id" is not null and "feature_policies"."user_id" is null) or ("feature_policies"."scope"='USER' and "feature_policies"."plan_id" is null and "feature_policies"."tenant_id" is null and "feature_policies"."user_id" is not null)),
	CONSTRAINT "feature_policy_state_valid" CHECK ("feature_policies"."revision">=0 and "feature_policies"."mode" in ('ENABLED','DISABLED','INHERIT'))
);
--> statement-breakpoint
CREATE TABLE "feature_policy_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"mode" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"ticket" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_policy_change_revision_uq" UNIQUE("policy_id","revision"),
	CONSTRAINT "feature_policy_change_intent_uq" UNIQUE("actor_id","request_key"),
	CONSTRAINT "feature_policy_change_valid" CHECK ("feature_policy_changes"."revision">0 and "feature_policy_changes"."mode" in ('ENABLED','DISABLED','INHERIT') and "feature_policy_changes"."input_hash" ~ '^[a-f0-9]{64}$' and "feature_policy_changes"."ticket" ~ '^[A-Za-z0-9_-]{3,80}$')
);
--> statement-breakpoint
ALTER TABLE "feature_policies" ADD CONSTRAINT "feature_policies_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_policies" ADD CONSTRAINT "feature_policies_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_policies" ADD CONSTRAINT "feature_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_policies" ADD CONSTRAINT "feature_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_policy_changes" ADD CONSTRAINT "feature_policy_changes_policy_id_feature_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."feature_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_policy_changes" ADD CONSTRAINT "feature_policy_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_policy_actor_idx" ON "feature_policies" USING btree ("updated_by");--> statement-breakpoint
CREATE INDEX "feature_policy_user_idx" ON "feature_policies" USING btree ("user_id","feature");--> statement-breakpoint
CREATE INDEX "feature_policy_tenant_idx" ON "feature_policies" USING btree ("tenant_id","feature");--> statement-breakpoint
CREATE INDEX "feature_policy_plan_idx" ON "feature_policies" USING btree ("plan_id","feature");--> statement-breakpoint
CREATE INDEX "feature_policy_global_idx" ON "feature_policies" USING btree ("feature") WHERE "feature_policies"."scope"='GLOBAL';--> statement-breakpoint
CREATE INDEX "feature_policy_change_history_idx" ON "feature_policy_changes" USING btree ("policy_id","created_at","id");
--> statement-breakpoint
CREATE FUNCTION protect_feature_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Feature policy history cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>0 OR NEW.mode<>'INHERIT' THEN RAISE EXCEPTION 'Feature policy requires change evidence'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.id,NEW.feature,NEW.scope,NEW.plan_id,NEW.tenant_id,NEW.user_id) IS DISTINCT FROM ROW(OLD.id,OLD.feature,OLD.scope,OLD.plan_id,OLD.tenant_id,OLD.user_id)
  OR NEW.revision<>OLD.revision+1 OR NOT EXISTS (
   SELECT 1 FROM feature_policy_changes c WHERE c.policy_id=OLD.id AND c.revision=NEW.revision AND c.mode=NEW.mode AND c.actor_id=NEW.updated_by AND c.correlation_id=NEW.correlation_id
  ) THEN RAISE EXCEPTION 'Feature policy requires fresh immutable change evidence'; END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER feature_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON feature_policies FOR EACH ROW EXECUTE FUNCTION protect_feature_policy();
--> statement-breakpoint
CREATE FUNCTION protect_feature_policy_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Feature policy change evidence is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER feature_policy_change_guard BEFORE UPDATE OR DELETE ON feature_policy_changes FOR EACH ROW EXECUTE FUNCTION protect_feature_policy_change();
