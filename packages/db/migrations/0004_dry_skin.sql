CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_name" text NOT NULL,
	"consent_type" text NOT NULL,
	"consent_version" text NOT NULL,
	"consent_text_hash" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by_user_id" uuid NOT NULL,
	"ip_address" text NOT NULL,
	"user_agent" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"idempotency_key" uuid NOT NULL,
	CONSTRAINT "consent_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "consent_idempotency_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "consent_type_valid" CHECK ("consent_records"."consent_type" in ('OWN_LIKENESS','THIRD_PARTY_LIKENESS','VOICE_CLONING','CROSS_BORDER_PROCESSING','AUTOMATED_PUBLISHING')),
	CONSTRAINT "consent_hash_valid" CHECK ("consent_records"."consent_text_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "consent_revocation_valid" CHECK (("consent_records"."revoked_at" is null and "consent_records"."revoked_by_user_id" is null) or ("consent_records"."revoked_at" >= "consent_records"."accepted_at" and "consent_records"."revoked_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "consent_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_subject_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "consent_subject_type_valid" CHECK ("consent_subjects"."type" in ('PERSON','VOICE','ORGANIZATION'))
);
--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_subject_id_consent_subjects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","subject_id") REFERENCES "public"."consent_subjects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_subjects" ADD CONSTRAINT "consent_subjects_tenant_id_brand_id_brands_tenant_id_id_fk" FOREIGN KEY ("tenant_id","brand_id") REFERENCES "public"."brands"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_subject_active_idx" ON "consent_records" USING btree ("tenant_id","subject_id","consent_type","revoked_at");--> statement-breakpoint
CREATE FUNCTION contentos_protect_consent_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND
     (to_jsonb(NEW) - 'revoked_at' - 'revoked_by_user_id') = (to_jsonb(OLD) - 'revoked_at' - 'revoked_by_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Consent evidence is immutable; only first revocation is allowed' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER consent_evidence_immutable BEFORE UPDATE OR DELETE ON consent_records FOR EACH ROW EXECUTE FUNCTION contentos_protect_consent_evidence();
