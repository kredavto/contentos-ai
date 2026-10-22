CREATE TABLE "youtube_oauth_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"state_hash" text NOT NULL,
	"verifier" jsonb,
	"connection_id" uuid NOT NULL,
	"reconnect_id" uuid,
	"revision" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now()+interval '10 minutes' NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "youtube_oauth_state_uq" UNIQUE("state_hash"),
	CONSTRAINT "youtube_oauth_state_valid" CHECK ("youtube_oauth_attempts"."state_hash" ~ '^[a-f0-9]{64}$' and "youtube_oauth_attempts"."status" in ('PENDING','EXCHANGING','COMPLETED','FAILED')),
	CONSTRAINT "youtube_oauth_verifier_valid" CHECK (("youtube_oauth_attempts"."status"='PENDING' and "youtube_oauth_attempts"."verifier" is not null) or ("youtube_oauth_attempts"."status"<>'PENDING' and "youtube_oauth_attempts"."verifier" is null)),
	CONSTRAINT "youtube_oauth_reconnect_valid" CHECK (("youtube_oauth_attempts"."reconnect_id" is null and "youtube_oauth_attempts"."revision" is null) or ("youtube_oauth_attempts"."reconnect_id" is not null and "youtube_oauth_attempts"."revision" is not null and "youtube_oauth_attempts"."revision" >= 0 and "youtube_oauth_attempts"."connection_id"="youtube_oauth_attempts"."reconnect_id"))
);
--> statement-breakpoint
ALTER TABLE "youtube_oauth_attempts" ADD CONSTRAINT "youtube_oauth_attempts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_oauth_attempts" ADD CONSTRAINT "youtube_oauth_attempts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_oauth_attempts" ADD CONSTRAINT "youtube_oauth_attempts_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "youtube_oauth_attempts" ADD CONSTRAINT "youtube_oauth_attempts_tenant_id_reconnect_id_social_connections_tenant_id_id_fk" FOREIGN KEY ("tenant_id","reconnect_id") REFERENCES "public"."social_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "youtube_oauth_expiry_idx" ON "youtube_oauth_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "youtube_oauth_actor_idx" ON "youtube_oauth_attempts" USING btree ("tenant_id","created_by","session_id");