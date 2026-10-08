CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"request_key" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"encrypted_token" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "team_invitation_email_normalized" CHECK ("team_invitations"."email"=lower(trim("team_invitations"."email"))),
	CONSTRAINT "team_invitation_role_valid" CHECK ("team_invitations"."role" in ('ADMIN','MANAGER','EDITOR','CLIENT_APPROVER','VIEWER')),
	CONSTRAINT "team_invitation_state_valid" CHECK (("team_invitations"."accepted_at" is null) = ("team_invitations"."accepted_by" is null) and not ("team_invitations"."accepted_at" is not null and "team_invitations"."revoked_at" is not null) and (("team_invitations"."accepted_at" is null and "team_invitations"."revoked_at" is null) = ("team_invitations"."encrypted_token" is not null))),
	CONSTRAINT "team_invitation_expiry_valid" CHECK ("team_invitations"."expires_at">"team_invitations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "organization_members" ADD COLUMN "revision" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_tenant_id_organizations_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitation_request_uq" ON "team_invitations" USING btree ("tenant_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitation_token_uq" ON "team_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "team_invitation_tenant_idx" ON "team_invitations" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE FUNCTION guard_team_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.tenant_id,NEW.created_by,NEW.email,NEW.role,NEW.request_key,NEW.token_hash,NEW.created_at,NEW.expires_at)
      IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.created_by,OLD.email,OLD.role,OLD.request_key,OLD.token_hash,OLD.created_at,OLD.expires_at) THEN
    RAISE EXCEPTION 'Team invitation identity is immutable';
  END IF;
  IF (OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL) AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal team invitation is immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER team_invitation_guard BEFORE UPDATE ON team_invitations FOR EACH ROW EXECUTE FUNCTION guard_team_invitation();
