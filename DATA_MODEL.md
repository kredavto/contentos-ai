# Data model

This is the target model. The current schema and completed subsets are recorded in [implementation status](docs/IMPLEMENTATION_STATUS.md); not all tables below have been implemented.

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

Implemented media slice: `media_assets` has a tenant/brand foreign key, tenant-scoped upload-idempotency uniqueness, upload and deletion leases, content validation constraints and cleanup indexes. `consent_subjects` and immutable `consent_records` retain exact policy evidence and revocation.

Performance reporting (0018–0020): performance_reports stores the immutable evidence snapshot, validated output, analyzed strategy version and Brand Brain revision; strategy_recommendations stores bounded proposed field replacements; strategy_recommendation_decisions stores append-only manager acceptance/rejection with unique intent and recommendation keys. Composite tenant/version foreign keys preserve ownership. Accepted decisions reference a newly appended strategy_versions row, authored by the accepting user without an AI job ID. Existing generated versions retain their job references. Performance job intent cannot be mutated while normal execution state, leases and retries remain writable.

Billing foundation (migration 0021): `plans` are disabled until configured; `plan_versions` freeze monetary prices and resource entitlements. `billing_orders` freeze tenant intent and receipt data. `payments` uniquely map merchant/test/provider external IDs to orders. `payment_settlements` retain validated paid evidence. Financial history is append-only, tenant references are constrained, and settlement identity is guarded in PostgreSQL. Subscription terms and recurring consent are still pending.

Migration 0022 adds `subscriptions` (one identity per tenant) and append-only `subscription_terms`. Every term references a settled order and its immutable plan version. UTC monthly-boundary checks and a tenant-locked overlap trigger prevent inconsistent paid periods. Terms, settlement and ledger purchases commit atomically; no automatic renewal preference is implied by a paid term.

Migration 0023 adds `billing_renewal_consents`, `billing_renewal_preferences` and `billing_renewal_changes`. Consents freeze a plan price and policy text/hash; append-only change events record acceptance/cancellation. The current pointer has a tenant-scoped consent FK and revision. Database triggers prohibit history mutation and ensure consent amounts match their plan version. Payment dispatch is not connected to these records yet.

Migration 0024 adds `billing_payment_methods` (68 tables total) and consent/revision references on immutable orders. A method references a settled order and matching tenant consent. Its encrypted credential is cleared on revocation. Guards validate active permission on insertion, freeze method identity and prevent revival after revocation. Checkout without saving has no consent binding; a saving checkout requires both consent and revision.

Migration 0025 adds `payment_tasks` (69 tables total), an organization-scoped task and durable outbox keyed by the immutable order UUID. It retains dispatch timing, leases, bounded attempt/submission counts, first-send timestamp and sanitized provider observation/confirmation. Checks enforce status/lease consistency; a trigger freezes identity and prevents resetting submission history. Newly created orders insert their task atomically. Historical orders are not automatically submitted.

Migration 0026 adds `webhook_events` (70 tables total): immutable minimal provider receipt identity, merchant/mode-scoped event uniqueness, processing leases, retry timing and dispatch indexes. It deliberately stores no raw payment payload or unverified tenant/order metadata. The authenticated provider lookup resolves the existing order before tenant-locked reconciliation.

Migrations 0027–0028 add `billing_renewal_intents` (71 tables total), with unique tenant/paid-term and immutable order/term/method bindings. A composite term identity supports tenant FKs; method IDs equal their originating settled order IDs by the existing check. Deferred constraints require renewal bindings at commit. Order JSON cannot contain the decrypted paymentMethodId, and renewal kind/mode must agree.
