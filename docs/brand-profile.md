# Completed Brand Brain profile editing

After onboarding, OWNER, ADMIN and MANAGER members can edit the brand name, website, niche, geography, positioning/USP, tone of voice, goals and planned publishing channels from the completed Brand Brain page. The account must still be enabled and its email verified. Other members retain the summary view.

`PUT /api/organizations/:tenant/brands/:brand/profile` accepts a strict `{ revision, data }` body. The common API checks the authenticated session, exact Origin, request size and shared mutation rate limit. The service validates IDs and fields. The repository locks the tenant, rechecks current membership, locks the brand, requires completed onboarding and checks the optimistic revision. Profile, voice, brand revision and audit event commit together. A stale browser receives CONFLICT and keeps its unsaved text; the user can copy it before refreshing.

Audience, product and other structured list rows retain their IDs and contents. The voice row is updated in place. Generation requests already capture the normalized Brand Brain and its revision; enqueue rejects a context that changed between reading and acceptance. Existing jobs retain their original snapshot, and existing strategy/script versions are not rewritten. Performance recommendations retain their existing revision-baseline checks.

Audit metadata records old/new revision numbers without brand text. Editing structured entity lists, including desires, objections, offers, rules and pillars, remains a separate implementation task; this editor does not claim to cover those entities.

Verification: PostgreSQL integration tests exercise draft/complete boundaries, tenant and role checks, validation, concurrent updates, stable entity IDs, audit metadata and current account status. A Chrome scenario covers editing, reload persistence, stale browser rejection and mobile overflow.
