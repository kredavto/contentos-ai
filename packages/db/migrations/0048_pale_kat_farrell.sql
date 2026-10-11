ALTER TABLE "generated_images" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;--> statement-breakpoint
CREATE INDEX "image_submitted_tenant_idx" ON "generated_images" USING btree ("submitted_at","tenant_id");--> statement-breakpoint
CREATE INDEX "image_created_tenant_idx" ON "generated_images" USING btree ("created_at","tenant_id");--> statement-breakpoint
ALTER TABLE "generated_images" ADD CONSTRAINT "image_currency_valid" CHECK ("generated_images"."currency" ~ '^[A-Z]{3}$');