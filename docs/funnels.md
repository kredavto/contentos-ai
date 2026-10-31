# Content → CTA funnel records and manual reports

The brand studio's Funnels tab binds an existing content item to an explicit CTA, destination category (URL, website, Telegram, lead form or messenger) and an active saved UTM link. The stored tagged URL is displayed for manual use; creating a record neither edits a caption nor publishes a post. Destination categories are labels, not integrations or generated lead forms. Content/active-link selectors support literal case-insensitive title search and cursor pagination.

Migration 0041 adds immutable `funnel_targets` and `funnel_measurements`. Composite tenant/brand foreign keys require the content, link and target to belong to the same brand. Its generated constraint order was corrected before the first successful application: referenced unique constraints must exist before adding dependent foreign keys. Historical target bindings and measurement payloads cannot be updated or deleted through the database's append-only triggers. UTM archiving remains independent: it prevents new targets using that link but does not rewrite existing targets or distributed URLs. Existing content titles are read from the current content record.

Verified OWNER/ADMIN/MANAGER/EDITOR members can create bindings. Manual measurement writes require verified OWNER/ADMIN/MANAGER; other current members can read. Every write locks the tenant and rechecks membership before looking up an idempotency key. Keys bind the actor, target/brand and validated input; exact retry returns its original result, changed intent conflicts. Revoked membership blocks even old retries. Audits store resource/action/correlation IDs and report version only, never CTA text, URLs or report source text.

## Manual evidence, not automated attribution

A report covers an explicit UTC half-open interval `[from,to)` of up to 93 days, ending no later than submission time. It stores integer clicks and/or leads, each nullable, plus a short source description. Null means unknown, zero means explicitly entered zero. At least one metric is required. Do not enter personal lead data or credentials in source descriptions. No IP, cookie, visitor identifier, lead contact or browsing event is collected by this module.

For the exact target/period, the first report requires expectedVersion 0. Corrections append the next version after checking expectedVersion under the tenant lock; concurrent stale writers conflict. Read projections identify each period's current version so the UI disables correction from replaced history. Previous versions remain visible. The UI supports exact millisecond UTC periods, preserves period boundaries during correction and retains retry keys after uncertain responses. Overlapping periods are permitted as separate reports; the UI explicitly avoids summing them. No conversion rate or cross-period total is inferred from potentially incompatible sources. The platform does not verify manual evidence against an external source.

Target, choice and history lists use at most 50 rows per page, with stable descending UUID cursors, not chronological ordering. The choice search has a five-second database statement timeout. Mutation routes inherit cookie-session/Origin checks, body limits, safe errors, no-store responses and the shared mutation rate budget.

Routes under `/api/organizations/:tenant/brands/:brand/funnels`: GET list, POST create; GET `/choices` with `kind=CONTENT|LINK`, optional search and cursor; GET/POST `/:target/measurements` for history/append. No public endpoint, redirect, tracking pixel, external webhook or destination fetch is added.

## Remaining scope

Automatic click-to-lead attribution, CRM/web-analytics ingestion, public lead forms, messenger integrations, verified external event provenance and retention/deletion orchestration remain unfinished. These manual aggregate records are business data and are not included in the personal-account JSON export. No real customer report or external lead collection was performed during implementation.
