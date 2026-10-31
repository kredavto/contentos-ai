CREATE TABLE "platform_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"reason" text NOT NULL,
	"ticket" text NOT NULL,
	"request_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"revoked_sessions" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_action_valid" CHECK ("platform_actions"."operation" = 'REVOKE_SESSIONS' and "platform_actions"."reason" in ('USER_REQUEST','SECURITY_INCIDENT','SUPPORT_CASE') and "platform_actions"."ticket" ~ '^[A-Za-z0-9_-]{3,80}$' and "platform_actions"."revoked_sessions" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform_operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_operator_role_valid" CHECK ("platform_operators"."role" in ('SUPPORT','ADMIN'))
);
--> statement-breakpoint
ALTER TABLE "platform_actions" ADD CONSTRAINT "platform_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_actions" ADD CONSTRAINT "platform_actions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_operators" ADD CONSTRAINT "platform_operators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_action_intent_uq" ON "platform_actions" USING btree ("actor_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_operators_user_uq" ON "platform_operators" USING btree ("user_id");--> statement-breakpoint
CREATE FUNCTION protect_platform_action() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Platform action records are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER platform_action_update_guard BEFORE UPDATE ON platform_actions FOR EACH ROW EXECUTE FUNCTION protect_platform_action();
