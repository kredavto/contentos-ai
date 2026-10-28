# Organization search

GET /api/organizations/:tenantId/search accepts a trimmed literal query `q` (2–120 characters), optional kind BRAND/IDEA/SCRIPT/CONTENT/PUBLICATION and paired afterKind/afterId cursor. Authentication and current tenant membership are required on every page. A shared per-user search throttle, transaction-local three-second SQL statement timeout and maximum 30 returned rows bound requests. Responses use the common no-store API boundary. Search terms are not added to audit metadata.

PostgreSQL case-insensitive substring search treats %, _ and backslash literally. Results are ordered by kind and UUID, with keyset pagination; this is not relevance ranking or a frozen snapshot. Concurrent inserts/edits can change subsequent pages. The query searches all matching tenant rows, independent of the overview's 100-row cap. It projects bounded titles/excerpts and internal entity/brand identifiers only. Scripts use their current version; posts and carousel text use current versions. Historical script text, fact-check notes, encrypted connections and operational job payloads are excluded. Publication captions come from their stored publishing snapshot.

The dashboard form resets synchronously with the organization, aborts stale requests, and supports kind filters, explicit submission and first/previous/next-page navigation. Only cursor bookmarks are retained for at most 50 pages; earlier result objects and excerpts are not cached. Back and first-page navigation fetch again through the authenticated no-store API. At the retained-history boundary, previous-page navigation is disabled and a first-page restart remains available. Page numbers describe traversal position, not a stable snapshot or total count.

Navigation history commits only when the target request succeeds. A failed next/back request leaves the displayed page and its cursor history intact for retry. Newly submitted query/filter values reset history; a changed query can supersede an in-flight page request. Request identity plus AbortController fencing prevents an older response or finalizer from replacing the new query, clearing its pending state, or crossing an organization reset. A synchronous ref guard also blocks repeated page clicks before disabled controls render. SCRIPT and IDEA results use dedicated read-only destinations described below; other kinds still open the appropriate brand section. Exact editor selection and other entity-specific destinations remain UX extensions. There is no external provider call. Search uses existing relational tables; no new migration is required. Large-tenant performance and search indexes remain to be measured before production scale claims.

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
response; reload obtains current data and rechecks permission. IDEA also has a local read-only destination described below; other search kinds
still open their brand sections. Exact editing/deeplinks for other entity types
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
