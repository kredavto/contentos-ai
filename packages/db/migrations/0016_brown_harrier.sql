CREATE TABLE "publication_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"source_note" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"input_hash" text NOT NULL,
	CONSTRAINT "publication_metrics_intent_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "publication_metrics_source_valid" CHECK ("publication_metrics"."source" = 'MANUAL'),
	CONSTRAINT "publication_metrics_note_valid" CHECK (length("publication_metrics"."source_note") between 3 and 500)
);
--> statement-breakpoint
ALTER TABLE "publication_metrics" ADD CONSTRAINT "publication_metrics_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_metrics" ADD CONSTRAINT "publication_metrics_tenant_id_publication_id_publications_tenant_id_id_fk" FOREIGN KEY ("tenant_id","publication_id") REFERENCES "public"."publications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publication_metrics_history_idx" ON "publication_metrics" USING btree ("tenant_id","publication_id","observed_at","recorded_at");
--> statement-breakpoint
CREATE TRIGGER publication_metrics_append_only BEFORE UPDATE OR DELETE ON publication_metrics FOR EACH ROW EXECUTE FUNCTION contentos_reject_history_mutation();
