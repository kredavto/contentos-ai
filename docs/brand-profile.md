# Completed Brand Brain profile editing

After onboarding, OWNER, ADMIN and MANAGER members can edit the brand name, website, niche, geography, positioning/USP, tone of voice, goals and planned publishing channels from the completed Brand Brain page. The account must still be enabled and its email verified. Other members retain the summary view.

`PUT /api/organizations/:tenant/brands/:brand/profile` accepts a strict `{ revision, data }` body. The common API checks the authenticated session, exact Origin, request size and shared mutation rate limit. The service validates IDs and fields. The repository locks the tenant, rechecks current membership, locks the brand, requires completed onboarding and checks the optimistic revision. Profile, voice, brand revision and audit event commit together. A stale browser receives CONFLICT and keeps its unsaved text; the user can copy it before refreshing.

Audience, product and other structured list rows retain their IDs and contents. The voice row is updated in place. Generation requests already capture the normalized Brand Brain and its revision; enqueue rejects a context that changed between reading and acceptance. Existing jobs retain their original snapshot, and existing strategy/script versions are not rewritten. Performance recommendations retain their existing revision-baseline checks.

Audit metadata records old/new revision numbers without brand text. Structured entity editing is covered by the collection editor described below.

Verification: PostgreSQL integration tests exercise draft/complete boundaries, tenant and role checks, validation, concurrent updates, stable entity IDs, audit metadata and current account status. A Chrome scenario covers editing, reload persistence, stale browser rejection and mobile overflow.

## Structured collections

The completed page also exposes all 13 structured collections: products, audience segments, pains, desires, objections, competitors, positioning, pillars, offers, lead magnets, CTAs, brand rules and reference content. The collection API uses `GET/PUT /api/organizations/:tenant/brands/:brand/brain/:collection`. A save validates `{ revision, entries: [{ id?, name, description }] }`, updates existing IDs, inserts new entries and archives omitted entries. It never hard-deletes an audience or pillar referenced by old content. Archived entries cannot be silently revived or reassigned to another brand. Active products, audiences, pains and CTAs cannot become empty; original collection size limits are retained.

All collections share the brand revision, current verified writer permissions, tenant lock and brand lock. Duplicate, foreign, missing or archived entry IDs are rejected before mutation. The audit records collection, revision and count, without content. Readers can view every collection but cannot save it. The editor warns before abandoning changed sections and retains unsaved fields after a conflict.

New AI snapshots include the six previously unused collections. Their schema fields are optional for compatibility with already queued snapshots; draft onboarding continues to return its original shape. `archived_at` is introduced additively by migration 0033. The basic profile editor and collection editor cannot be edited concurrently on the same page.
