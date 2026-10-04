CREATE TABLE "social_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"reference" jsonb NOT NULL,
	"name" text NOT NULL,
	"username" text,
	"status" text NOT NULL,
	"credential" jsonb,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"last_checked_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "social_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "social_status_valid" CHECK ("social_connections"."status" in ('PENDING','CONNECTED','LIMITED','ACTIVE','TOKEN_EXPIRED','REVOKED','ERROR')),
	CONSTRAINT "social_revision_valid" CHECK ("social_connections"."revision" >= 0 and "social_connections"."credential_version" >= 1),
	CONSTRAINT "social_credential_required" CHECK (("social_connections"."status" = 'REVOKED' and "social_connections"."credential" is null) or ("social_connections"."status" <> 'REVOKED' and "social_connections"."credential" is not null)),
	CONSTRAINT "social_reference_valid" CHECK ("social_connections"."reference"->>'provider' = "social_connections"."provider" and "social_connections"."reference"->>'internalId' = "social_connections"."id"::text)
);
--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_channel_uq" ON "social_connections" USING btree ("tenant_id","brand_id","provider",("reference"->>'externalId'));