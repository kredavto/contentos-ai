# Organization search

GET /api/organizations/:tenantId/search accepts a trimmed literal query `q` (2–120 characters), optional kind BRAND/IDEA/SCRIPT/CONTENT/PUBLICATION and paired afterKind/afterId cursor. Authentication and current tenant membership are required on every page. A shared per-user search throttle, transaction-local three-second SQL statement timeout and maximum 30 returned rows bound requests. Responses use the common no-store API boundary. Search terms are not added to audit metadata.

PostgreSQL case-insensitive substring search treats %, _ and backslash literally. Results are ordered by kind and UUID, with keyset pagination; this is not relevance ranking or a frozen snapshot. Concurrent inserts/edits can change subsequent pages. The query searches all matching tenant rows, independent of the overview's 100-row cap. It projects bounded titles/excerpts and internal entity/brand identifiers only. Scripts use their current version; posts and carousel text use current versions. Historical script text, fact-check notes, encrypted connections and operational job payloads are excluded. Publication captions come from their stored publishing snapshot.

The dashboard form resets synchronously with the organization, aborts stale requests, and supports kind filters, explicit submission and first/previous/next-page navigation. Only cursor bookmarks are retained for at most 50 pages; earlier result objects and excerpts are not cached. Back and first-page navigation fetch again through the authenticated no-store API. At the retained-history boundary, previous-page navigation is disabled and a first-page restart remains available. Page numbers describe traversal position, not a stable snapshot or total count.

Navigation history commits only when the target request succeeds. A failed next/back request leaves the displayed page and its cursor history intact for retry. Newly submitted query/filter values reset history; a changed query can supersede an in-flight page request. Request identity plus AbortController fencing prevents an older response or finalizer from replacing the new query, clearing its pending state, or crossing an organization reset. A synchronous ref guard also blocks repeated page clicks before disabled controls render. SCRIPT, IDEA, PUBLICATION and CONTENT results use dedicated read-only destinations described below; BRAND opens its exact onboarding page. Exact editor selection and other entity-specific destinations remain UX extensions. There is no external provider call. Search uses existing relational tables; no new migration is required. Large-tenant performance and search indexes remain to be measured before production scale claims.

Acceptance passed: workspace/test-source TypeScript, ESLint, production build, 570 tests across 81 files and the Chrome scenario in tests/e2e/search.spec.ts. Coverage includes current-version text, literal wildcards, 105-row pagination, tenant/account denial, publication lookup, UI pagination/empty/error recovery and no-store. A 390px screenshot was inspected and the browser asserted no horizontal overflow. The initial browser attempt failed before execution due to a missing Playwright Chromium binary; the successful run used installed Chrome.

## Bounded history verification (2026-10-27)

Six focused search/history unit tests pass, covering literal input validation, first/back/forward transitions, fresh forward cursors, retained-window limits, immutable candidate transitions on errors and query reset. Full workspace/test TypeScript, ESLint and production build passed locally for this slice. The browser scenario now covers back/forward, failed-back retry, first-page restart, a late response superseded by a new query, filter/organization reset and mobile pagination controls. PostgreSQL is unavailable in this cloud workspace, so the updated browser scenario and visual screenshot have **not** been verified locally; CI must validate this exact revision. Earlier acceptance above is historical and does not establish acceptance of these changes.

## Exact read-only script destination

SCRIPT results now link to a dedicated current-script page rather than merely
opening the studio section. The scoped lookup joins the requested script to its
current version by tenant/script/version and checks current membership inside the
transaction. It does not depend on the studio overview's 100-newest-row limit.
Wrong tenant/brand/script, removed membership or a missing current version must
not fall back to another script. The page uses authenticated, dynamic server
rendering and retains the client-approver portal redirect.

The page is explicitly read-only: current version, platform, duration, approval
state, all script sections and fact-check notes. Text is escaped by React. It does
not save, approve, generate, schedule or select an editor draft. The displayed
version is current at page load, not a frozen snapshot from the earlier search
response; reload obtains current data and rechecks permission. IDEA, PUBLICATION and CONTENT also have read-only destinations described below; BRAND
opens its exact onboarding page. Exact editing/deeplinks for other entity types
and production-scale search performance remain unfinished.

No schema migration or external provider call is required. Repository tests must
cover old results beyond 100 newer scripts, exact scope, membership and current
version. Browser acceptance must cover search navigation, reload, viewer behavior,
wrong scope, permission revocation and mobile layout; pending checks are not
claimed as passed.

The dedicated unavailable view reveals no script title/content and is marked
`noindex`. With the application's loading/streaming boundary, Next.js can return
HTTP 200 for a streamed not-found view and 404 for a nonstreamed one; authorization
checks and unavailable UI are the privacy contract, not a blanket HTTP-status
assumption. Unexpected database/configuration errors are not disguised as missing
content. The page adds no nested main landmark beneath the root layout.

Local script-destination verification: **8 focused tests across four files** passed
and were independently repeated. Full workspace/test TypeScript, ESLint and a
fresh production build passed. The all-tests command completed with **371 passed
/ 536 skipped** (73 passing / 53 skipped files); unavailable PostgreSQL/Redis means
the three new repository cases and browser scenario are not locally accepted.
No screenshot inspection or full exact-commit CI pass is claimed yet.

## Exact read-only idea destination — local slice, 2026-10-28

IDEA hits now open `/brands/[id]/ideas/[ideaId]?organization=...` rather than
only the studio tab. An exact tenant/brand/idea query rechecks current membership
and disabled-user state inside the transaction, independent of the overview's
100-newest-ideas cap. The explicit projection excludes job IDs and operational
source data. Missing/wrong-scope ideas never substitute a different idea.

The dynamic authenticated page shows saved title, angle, hook, audience/pillar,
platform/format/funnel stage, current status and saved model scores/rationale.
Scores are not presented as outcome guarantees. React escapes text and score
labels. CLIENT_APPROVER remains redirected to its approval portal. No selection,
editing, generation, approval, provider call or database mutation is added.
Reload obtains current state and rechecks access. Unavailable views contain no
private content and use Next's noindex handling, including streamed responses.

The slice is local only, based on integration head `05eac316`; existing PR10 CI
does not validate these uncommitted changes. Unit tests cover UUID validation,
denial/failure propagation and exact encoded links. Three PostgreSQL cases cover
the capped overview, current state, wrong tenant/brand/account, removed ideas,
revoked membership and disabled accounts. A browser scenario covers anonymous
redirect, exact search navigation, reload, read-only/escaping, mobile layout,
wrong/duplicate scope, approver redirect and revocation. Database/browser tests
are prepared but not executed here because services are unavailable. No migration,
lockfile, deployment or old plan-limit reconstruction is included.

## Exact read-only publication destination — local slice, 2026-10-28

PUBLICATION hits now open `/brands/[id]/publications/[publicationId]` with explicit
organization scope. This uses `publications.id`, never a publishing-job ID, and
reads exact stored evidence outside the publishing overview's 100-job cap.
Membership and disabled-user checks occur within the read transaction. Publication,
job, brand and current content joins bind tenant and brand; inconsistent legacy
same-tenant/different-brand content pointers fail closed rather than leaking data.

The page displays saved snapshot title/caption/type/privacy/comment setting/time
zone, stored job status and UTC timestamps. The current content title is separately
labelled when changed. Recorded result time may be a system verification time,
particularly for YouTube, rather than exact platform publication time. This is not
a claim of current external availability, visibility or content. Reload rechecks
access without a provider request. Authentication, CLIENT_APPROVER redirect,
escaped rendering, unavailable/noindex handling and read-only controls follow the
existing script/idea destinations. There are no send/cancel/approve controls.

Only safe fields are projected: no raw provider reference, external URL, signed
media URL, storage key, credential, connection/job identifiers or full snapshot.
Historical reads do not require an active social connection or configured provider.
No new migration, dependency, API, external operation or old plan-limit patch.

This slice is local on PR11 `5d54a360`; prior CI does not validate these changes.
Four PostgreSQL cases cover the overview cap, immutable snapshot vs renamed current
content, absent/raw data, wrong ID/tenant/brand/account, inconsistent content links,
revoked membership and disabled accounts. A browser/mobile scenario covers exact
search navigation, anonymous redirect, reload, escaping, no private marker/unsafe
link, job-ID denial, duplicate scope, approver redirect and membership revocation.
Database/browser acceptance remains pending because local services are unavailable.
No mobile screenshot has been inspected for this slice yet.

Historical acceptance update: IDEA was subsequently published with explicit
permission as draft PR11 at `5d54a360`. CI run 40759452804 passed all 966 tests in
131 files without skips and all 39 Chromium scenarios, plus migrations, types,
lint and build. The IDEA mobile screenshot was inspected. This supersedes the
IDEA-only pending notes above, not the new unpublished PUBLICATION slice.

## Exact read-only CONTENT destination — local slice, 2026-10-29

CONTENT results now open `/brands/[id]/content/[contentId]?organization=...`,
using the exact content-item ID rather than a post/carousel ID or the calendar
section. A single tenant/brand-bound query reads current POST/CAROUSEL text with
membership/disabled-user checks in the transaction, outside the 100-row studio
caps. Joins require the matching content type and current version. Existing
subtypes with missing current versions fail unavailable rather than substituting
historical or sibling text. Absent post/carousel entities show an explicit no-text
state; other content types show metadata only, without media or related scripts.

The dynamic authenticated page displays current material metadata, saved text,
version/approval state, carousel archive/lifecycle status, escaped slides/caption,
hashtags and fact-check notes. Carousel design is not executed or applied as CSS;
this is textual inspection, not a graphical export. CLIENT_APPROVER redirects to
the approval portal. No editor, selection, approval, generation, media signing,
provider request or publishing operation is added. Reload rechecks scope and
reads current saved data. Material status is not a live external-platform claim.

The slice is local on published PR12 `1293c830`; prior CI does not cover it.
Seven prepared PostgreSQL cases cover both capped lists, archived/current state,
immutable history, absent-text/metadata-only branches, subtype mismatch suppression,
missing current versions, exact scope and revoked/disabled accounts. A browser
scenario covers both search destinations, reload, escaping, read-only and mobile
layout, no-text/metadata-only states, incorrect scope/entity ID, anonymous/approver
redirects and revocation. No local DB/browser or visual acceptance is claimed:
PostgreSQL/Redis services are unavailable. No migration, dependency/workflow change,
old plan-limit reconstruction, publication, merge or deployment.

Prior PUBLICATION acceptance: PR12 head `1293c830` passed CI run 40788677032:
973 tests/133 files without skips and 40 Chromium scenarios, migrations, types,
lint and build. Its mobile screenshot was visually inspected and results posted
with explicit permission in PR comment 6488327261. This supersedes PUBLICATION
pending notes above, not the new CONTENT slice. Exact editing, media preview and
production-scale search performance remain separate unfinished work.
