ALTER TABLE "content_items" ADD CONSTRAINT "content_items_brand_id_uq" UNIQUE("tenant_id","brand_id","id");
--> statement-breakpoint
ALTER TABLE "utm_links" ADD CONSTRAINT "utm_brand_id_uq" UNIQUE("tenant_id","brand_id","id");
--> statement-breakpoint
CREATE TABLE "funnel_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	"clicks" integer,
	"leads" integer,
	"source" text NOT NULL,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funnel_measurement_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "funnel_measurement_version_uq" UNIQUE("target_id","from_at","to_at","version"),
	CONSTRAINT "funnel_measurement_valid" CHECK ("funnel_measurements"."version">0 and "funnel_measurements"."to_at">"funnel_measurements"."from_at" and "funnel_measurements"."to_at"-"funnel_measurements"."from_at"<=interval '93 days' and ("funnel_measurements"."clicks" is not null or "funnel_measurements"."leads" is not null) and ("funnel_measurements"."clicks" is null or "funnel_measurements"."clicks" between 0 and 1000000000) and ("funnel_measurements"."leads" is null or "funnel_measurements"."leads" between 0 and 1000000000))
);
--> statement-breakpoint
CREATE TABLE "funnel_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"content_item_id" uuid NOT NULL,
	"utm_link_id" uuid NOT NULL,
	"cta" text NOT NULL,
	"destination_type" text NOT NULL,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funnel_target_scope_uq" UNIQUE("tenant_id","brand_id","id"),
	CONSTRAINT "funnel_target_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "funnel_destination_valid" CHECK ("funnel_targets"."destination_type" in ('URL','WEBSITE','TELEGRAM','LEAD_FORM','MESSENGER'))
);
--> statement-breakpoint
ALTER TABLE "funnel_measurements" ADD CONSTRAINT "funnel_measurements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_measurements" ADD CONSTRAINT "funnel_measurements_tenant_id_brand_id_target_id_funnel_targets_tenant_id_brand_id_id_fk" FOREIGN KEY ("tenant_id","brand_id","target_id") REFERENCES "public"."funnel_targets"("tenant_id","brand_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_targets" ADD CONSTRAINT "funnel_targets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_targets" ADD CONSTRAINT "funnel_targets_tenant_id_brand_id_content_item_id_content_items_tenant_id_brand_id_id_fk" FOREIGN KEY ("tenant_id","brand_id","content_item_id") REFERENCES "public"."content_items"("tenant_id","brand_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_targets" ADD CONSTRAINT "funnel_targets_tenant_id_brand_id_utm_link_id_utm_links_tenant_id_brand_id_id_fk" FOREIGN KEY ("tenant_id","brand_id","utm_link_id") REFERENCES "public"."utm_links"("tenant_id","brand_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "funnel_measurement_page_idx" ON "funnel_measurements" USING btree ("tenant_id","brand_id","target_id","id");--> statement-breakpoint
CREATE INDEX "funnel_target_page_idx" ON "funnel_targets" USING btree ("tenant_id","brand_id","id");--> statement-breakpoint
CREATE TRIGGER funnel_target_immutable BEFORE UPDATE OR DELETE ON funnel_targets FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER funnel_measurement_immutable BEFORE UPDATE OR DELETE ON funnel_measurements FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
