CREATE TABLE "voice_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"reference" jsonb NOT NULL,
	"name" text NOT NULL,
	"language" text,
	"preview_url" text,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "voice_catalog_uq" UNIQUE("tenant_id","brand_id","provider","external_id")
);
--> statement-breakpoint
ALTER TABLE "avatars" ADD COLUMN "voice_id" uuid;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatars" ADD CONSTRAINT "avatars_tenant_id_voice_id_voice_profiles_tenant_id_id_fk" FOREIGN KEY ("tenant_id","voice_id") REFERENCES "public"."voice_profiles"("tenant_id","id") ON DELETE no action ON UPDATE no action;