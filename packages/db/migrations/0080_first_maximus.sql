CREATE INDEX "jobs_requester_status_idx" ON "jobs" USING btree ("requested_by","status");--> statement-breakpoint
CREATE INDEX "media_uploader_status_idx" ON "media_assets" USING btree ("uploaded_by","status");--> statement-breakpoint
CREATE INDEX "social_creator_status_idx" ON "social_connections" USING btree ("created_by","status");--> statement-breakpoint
CREATE INDEX "library_media_uploader_status_idx" ON "library_media" USING btree ("uploaded_by","status");