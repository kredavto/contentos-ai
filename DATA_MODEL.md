# Data model

UUID keys and timestamptz timestamps throughout. `tenant_id` refers to organizations. OrganizationMember joins user/organization with OWNER, ADMIN, MANAGER, EDITOR, CLIENT_APPROVER or VIEWER; unique membership per pair. Workspaces belong to organizations; brands belong to workspace and organization. All tenant-owned child relations use matching tenant IDs and composite foreign keys.

Identity: users, sessions, auth_tokens, organizations, organization_members, workspaces, brands.
Brand Brain: brand_profiles, products, audience_segments, pain_points, desires, objections, competitors, positioning, brand_voice, brand_rules, offers, lead_magnets, ctas, content_pillars, reference_content.
Strategy: strategies, strategy_versions, strategy_recommendations. Unique version numbers per parent; versions append-only.
Content: ideas, content_items, content_versions, scripts, script_versions. Explicit state transitions, optimistic revisions and tenant-filtered indexes.
Media: avatars, avatar_looks, voices, consent_records, video_projects, video_transitions, media_assets, captions, covers. Subject-specific consent references; original and final storage keys differ.
Distribution: social_connections, publishing_jobs, publications, publication_metrics, raw_metrics, comments. Encrypted tokens; provider references are adapter mappings, never authorization keys.
Billing: plans, subscriptions, payments, usage_ledger, usage_reservations. Prices in plans. Integer AI_CREDITS and VIDEO_SECONDS. Ledger references operation/idempotency keys and is immutable; credits cannot be reserved concurrently beyond available balance.
Operations: jobs, outbox, webhook_events, notifications, audit_logs, feature_flags, deletion_requests. Unique provider/event key; audit keeps safe metadata rather than secret or sensitive content.

Indexes prioritize tenant + parent/status/scheduled_at. Monetary values use integer minor units plus currency. Missing metrics remain null/unavailable. Hard deletion follows ordered domain workflow; audit entries retain only minimal non-sensitive action metadata.
