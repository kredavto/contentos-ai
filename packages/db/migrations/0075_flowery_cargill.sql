CREATE INDEX "notification_email_user_created_idx" ON "notification_email_deliveries" USING btree ("user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notification_email_tenant_created_idx" ON "notification_email_deliveries" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notification_email_created_idx" ON "notification_email_deliveries" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "notification_preferences_user_idx" ON "notification_preferences" USING btree ("user_id");