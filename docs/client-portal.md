# Client approval portal

CLIENT_APPROVER memberships open a simplified dashboard with organization selection, pending-request count, status filters, privacy and logout. Clients can review assigned script/post/carousel/image/video requests, approve, reject, request changes or leave a standalone comment. Current roles and request visibility are checked on every operation. A comment does not change the request status.

Technical studio/onboarding pages redirect clients to approvals and the inbox does not expose studio navigation. Existing server mutation permissions continue to deny organization management, billing and content generation. This does not redefine all existing read permissions as per-brand authorization: agency client isolation uses separate organizations. Membership in one client organization never grants access to another.

Comments are append-only evidence, bounded to 200 per request and 2000 characters each; reads use 50-row cursor pages. Retry keys are scoped to tenant, request and author. PostgreSQL timestamp precision is retained during pagination. Audits exclude comment text. Comments remain available after a decision, subject to current access. Email delivery is separate work.

Verification: 593 tests in 85 files; five Chrome scenarios including full MVP; client dashboard, separate comments, filters/counts, direct studio redirect and mobile bounds checked. A separate loaded mobile screenshot was inspected. TypeScript, lint, migration and production build passed. This is local feature verification, not live production acceptance.
