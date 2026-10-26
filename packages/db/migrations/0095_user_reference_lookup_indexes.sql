-- Indexed global user-reference checks and tenant-scoped read paths.
-- Generated/reviewed before first application; preserve every existing index.
CREATE INDEX "agency_clients_created_by_user_lookup_idx" ON "public"."agency_clients" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "approval_comments_user_id_user_lookup_idx" ON "public"."approval_comments" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "approval_requests_requested_by_user_lookup_idx" ON "public"."approval_requests" USING btree ("requested_by");
--> statement-breakpoint
CREATE INDEX "approval_requests_requested_from_user_lookup_idx" ON "public"."approval_requests" USING btree ("requested_from");
--> statement-breakpoint
CREATE INDEX "approval_requests_resolved_by_user_lookup_idx" ON "public"."approval_requests" USING btree ("resolved_by") WHERE "resolved_by" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "billing_orders_requested_by_user_lookup_idx" ON "public"."billing_orders" USING btree ("requested_by");
--> statement-breakpoint
CREATE INDEX "billing_renewal_changes_actor_id_user_lookup_idx" ON "public"."billing_renewal_changes" USING btree ("actor_id");
--> statement-breakpoint
CREATE INDEX "calendar_entries_created_by_user_lookup_idx" ON "public"."calendar_entries" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "carousel_versions_created_by_user_lookup_idx" ON "public"."carousel_versions" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "carousels_approved_by_user_lookup_idx" ON "public"."carousels" USING btree ("approved_by") WHERE "approved_by" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "channel_analytics_jobs_requested_by_user_lookup_idx" ON "public"."channel_analytics_jobs" USING btree ("requested_by");
--> statement-breakpoint
CREATE INDEX "comment_deliveries_requested_by_user_lookup_idx" ON "public"."comment_deliveries" USING btree ("requested_by");
--> statement-breakpoint
CREATE INDEX "comment_imports_requested_by_user_lookup_idx" ON "public"."comment_imports" USING btree ("requested_by");
--> statement-breakpoint
CREATE INDEX "comment_reply_approval_revocations_revoked_by_user_lookup_idx" ON "public"."comment_reply_approval_revocations" USING btree ("revoked_by");
--> statement-breakpoint
CREATE INDEX "comment_reply_approvals_approved_by_user_lookup_idx" ON "public"."comment_reply_approvals" USING btree ("approved_by");
--> statement-breakpoint
CREATE INDEX "comment_reply_versions_created_by_user_lookup_idx" ON "public"."comment_reply_versions" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "content_versions_created_by_user_lookup_idx" ON "public"."content_versions" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "covers_requested_by_user_lookup_idx" ON "public"."covers" USING btree ("requested_by");
--> statement-breakpoint
CREATE INDEX "funnel_measurements_created_by_user_lookup_idx" ON "public"."funnel_measurements" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "funnel_targets_created_by_user_lookup_idx" ON "public"."funnel_targets" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "generated_images_approved_by_user_lookup_idx" ON "public"."generated_images" USING btree ("approved_by") WHERE "approved_by" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "generated_images_requested_by_user_lookup_idx" ON "public"."generated_images" USING btree ("requested_by");
--> statement-breakpoint
CREATE INDEX "platform_actions_target_user_id_user_lookup_idx" ON "public"."platform_actions" USING btree ("target_user_id");
--> statement-breakpoint
CREATE INDEX "posts_approved_by_user_lookup_idx" ON "public"."posts" USING btree ("approved_by") WHERE "approved_by" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "publication_analytics_jobs_requested_by_user_lookup_idx" ON "public"."publication_analytics_jobs" USING btree ("requested_by");
--> statement-breakpoint
CREATE INDEX "publication_metrics_recorded_by_user_lookup_idx" ON "public"."publication_metrics" USING btree ("recorded_by");
--> statement-breakpoint
CREATE INDEX "publishing_jobs_approved_by_user_lookup_idx" ON "public"."publishing_jobs" USING btree ("approved_by");
--> statement-breakpoint
CREATE INDEX "script_versions_created_by_user_lookup_idx" ON "public"."script_versions" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "scripts_approved_by_user_lookup_idx" ON "public"."scripts" USING btree ("approved_by") WHERE "approved_by" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "strategy_recommendation_decisions_actor_id_user_lookup_idx" ON "public"."strategy_recommendation_decisions" USING btree ("actor_id");
--> statement-breakpoint
CREATE INDEX "strategy_versions_created_by_user_lookup_idx" ON "public"."strategy_versions" USING btree ("created_by") WHERE "created_by" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "team_invitations_accepted_by_user_lookup_idx" ON "public"."team_invitations" USING btree ("accepted_by") WHERE "accepted_by" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "team_invitations_created_by_user_lookup_idx" ON "public"."team_invitations" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "utm_links_created_by_user_lookup_idx" ON "public"."utm_links" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "video_projects_approved_by_user_lookup_idx" ON "public"."video_projects" USING btree ("approved_by") WHERE "approved_by" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "youtube_oauth_attempts_created_by_user_lookup_idx" ON "public"."youtube_oauth_attempts" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX "brands_workspace_lookup_idx" ON "public"."brands" USING btree ("tenant_id", "workspace_id");
--> statement-breakpoint
CREATE INDEX "content_brand_status_lookup_idx" ON "public"."content_items" USING btree ("tenant_id", "brand_id", "status", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "jobs_tenant_created_lookup_idx" ON "public"."jobs" USING btree ("tenant_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "jobs_brand_created_lookup_idx" ON "public"."jobs" USING btree ("tenant_id", "brand_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "ledger_tenant_unit_created_lookup_idx" ON "public"."usage_ledger" USING btree ("tenant_id", "unit", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "ledger_tenant_created_lookup_idx" ON "public"."usage_ledger" USING btree ("tenant_id", "created_at", "id");
--> statement-breakpoint
CREATE INDEX "publishing_content_lookup_idx" ON "public"."publishing_jobs" USING btree ("tenant_id", "content_item_id");
--> statement-breakpoint
CREATE INDEX "publishing_brand_created_lookup_idx" ON "public"."publishing_jobs" USING btree ("tenant_id", "brand_id", "created_at", "id");
