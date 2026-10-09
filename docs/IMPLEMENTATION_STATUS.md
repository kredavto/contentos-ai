# Implementation status

Updated 2026-10-09. This is an implementation inventory, not a claim that the full specification is complete.

## Verified working slice

- pnpm 10.30.3 / Turborepo monorepo: apps/web, apps/worker and seven requested packages; strict TypeScript 5.9.3, ESLint 10, Vitest, Playwright.
- Next.js 16.3.8 Russian-first responsive UI with Tailwind 4, shared shadcn-style Radix/CVA button and original green/ivory visual design.
- Email/password registration, real SMTP adapter, email verification, reset links, login/logout and revoke-all-sessions API. scrypt N=131072/r=8/p=1; random tokens hashed at rest; HttpOnly/SameSite/Secure-in-production cookies.
- Atomic shared PostgreSQL rate limits, exact-Origin mutation checks, bounded JSON bodies, safe normalized API errors and correlation IDs.
- Persisted organizations/members/workspaces/brands. Role guards and tenant-scoped repository transactions; composite tenant foreign keys and database role/state constraints.
- Resumable 15-step onboarding, optimistic revisions, normalized Brand Brain rows, explicit completion and completed summary. A profile/voice editor is implemented with transactional role checks and optimistic revisions; all 13 structured collections now have an editor with stable IDs and archiving. See [profile editing](brand-profile.md).
- Database schema: 80 tables with thirty-seven SQL migrations (0000–0036). Initial migration's index-before-FK ordering was repaired before its first successful application; subsequent migrations are additive.
- Typed provider contracts for all requested provider categories; SMTP and OpenAI Responses adapters are implemented; OpenAI has contract tests but no live paid call.
- Local PostgreSQL 17, Redis 7 and Mailpit Compose stack is running. Separate PostgreSQL 16 container was used for initial integration/E2E development.
- CI workflow runs migrations, all typechecks, lint, unit/integration tests, production build and Playwright E2E. Remote CI passed all stages, including database and browser tests, for platform-admin commit 8ab4250 (run 37861591656). Newer tariff-publishing changes are locally verified and awaiting remote CI.

## Generation slice implemented

- Atomic immutable UsageLedger, separate AI_CREDITS/VIDEO_SECONDS, one trial per verified owner, database-backed pricing policies, concurrency-safe reservations/captures/releases, audit events.
- Durable jobs/outbox with BullMQ dispatcher, bounded exponential retries, database leases/fencing and heartbeat, recovery of lost queue delivery, authorization rechecks and safe terminal release.
- OpenAI Responses adapter with explicit model/key configuration, strict structured schema and bounded orchestrator repair/fallback. Provider usage recorded independently of user credits; unknown provider cost stays null. Explicit local/CI mock is blocked in production.
- Append-only strategies with 30-day plans, ideas/scoring, script generation/edit actions, manual editor, version history and version-specific approval. Tenant-authorized APIs, responsive content studio and polling progress.
- No OpenAI key created; no live paid provider call. Other integrations and full MVP remain incomplete.

## Consent and provider foundation

- Versioned, subject-scoped consent center: explicit acceptance, immutable evidence, idempotency, tenant and role checks, withdrawal of duplicate active grants, audit history and reload persistence. Avatar execution enforces original consent evidence; video execution enforces the same evidence and the approved script version.
- Official HeyGen v3 adapter: photo avatars/looks, public catalogs, voices, video submission/status and private avatar deletion. Bounded requests, validated responses, safe errors and idempotency propagation; contract-tested without paid requests.
- S3 adapter: tenant-prefixed private objects, bounded transfer sizes, MIME restrictions and short-lived signed downloads; SDK tested against a local HTTP fixture. Now wired to the private photo library.
- Authorized HeyGen account verified through the connected plugin. User selected their private avatar and a short test was submitted through the HeyGen plugin; provider accepted it and returned processing status. This does not verify the application server adapter end to end. The separate server API key is unavailable until the account completes API funding; no payment or key creation was performed.

## Private photo library

- Tenant/brand-owned photo uploads, stream/body limits, real raster decoding and MIME checks, orientation, metadata removal, private JPEG storage, signed previews and writer-role checks.
- Upload intent idempotency and lease fencing; database-backed deletion with retries, abandoned-upload cleanup and late-write sweeps. See [media workflow](media-storage.md).
- The Media tab supports upload, preview and deletion; mobile tabs wrap to keep every section visible. Real cloud bucket configuration remains outstanding.

## Avatar Studio

- Tenant/brand-owned private avatars and looks, consent-bound source selection, configurable credit reservation, outbox jobs and persistent worker processing. Additional looks share a verified owned group.
- Stable HeyGen keys with a conservative 23-hour replay window, submission markers, three consecutive-error budget, separate normal status polling and explicit reconciliation state. Late references are retained for cancellation cleanup; unknown operations never automatically regenerate under a new key.
- Russian Avatar tab, readiness/progress, explicit development DEMO, manager resume and group deletion. Production mock forbidden; missing server credentials remain CONFIGURATION_REQUIRED. See [avatar workflow](avatar-jobs.md).
- Expired unknown submissions still need an operator investigation workflow; private voice cloning/import and provider configuration UI remain pending.

## Public voice selection

- Paginated HeyGen public voice catalog with tenant/brand-owned internal profile IDs, stable refresh, bounded responses and 30 refresh requests per tenant per minute.
- Avatar voice selection checks writer role, brand and matching provider. Optional public sample playback; no private account voices are discovered or exposed. Cloning remains pending and will require VOICE_CLONING evidence.
- Server credentials use the same configured HeyGen connection. No live catalog request was made without the missing API key; development uses an explicit demo voice.

## Video processing foundation

- Real worker-only FFmpeg processor: MP4 probing, bounded input/output, three orientations, 720p/1080p, crop/contain, H.264/AAC, audio normalization, metadata removal, Unicode subtitle burn-in and separate JPEG cover frame. No watermark is added.
- Local paths/filter arguments are generated internally; shell/network inputs are disallowed, MOV external references disabled, subprocess environment excludes credentials, timeouts/cancellation and temporary cleanup are enforced. Final codecs/dimensions/duration are checked.
- Six real media tests passed with FFmpeg/FFprobe 9.0.2; CI now installs FFmpeg before tests. See [processing boundaries](video-processing.md). This is now connected to durable video projects and the Video Studio workflow.

## Historical verification evidence (initial generation/consent slice)

- Typecheck for all 9 workspace packages and test sources passed.
- ESLint passed.
- 69 tests in 14 Vitest files passed against real PostgreSQL 17. Coverage: role policy, foreign-key tenant isolation, concurrent token consumption, sessions/password reset, stale login prevention, atomic rate limits, normalized onboarding and revision conflicts, consent evidence/revocation, HeyGen/S3 contracts, safe photo decoding, upload idempotency, tenant/brand media access, avatar reservation/capture/release, consent-bound jobs, expired replay windows, late references, normal polling and durable deletion/fencing.
- 2 Playwright tests passed in installed Chrome: register → SMTP email → verify → login → organization → brand → 15 onboarding steps → save/reload/resume → Brand Brain → starter credits → strategy/30-day plan → ideas → script → manual edit/version history → approval → mobile logout, consent acceptance → revocation → reload persistence, photo upload → signed preview → consent grant → avatar job → ready → credit capture → public voice selection/reopen persistence → worker group deletion → photo deletion, plus CSRF/anonymous request rejection. HttpOnly/SameSite cookie assertions and no browser page errors.
- Agent-browser verified homepage renders, navigation exists and no Next error overlay/browser errors. Desktop/mobile dashboard, media-library and avatar screenshots visually inspected; mobile overflow check passed.
- Production Next.js build passed for implemented routes.
- Browser tests caught and fixed Strict Mode token clearing and textarea label association after reload.

## Full objective still outstanding

- Production SMTP/domain setup and live mail verification; OAuth authentication flows.
- Additional AI workflows beyond the implemented strategy/ideas/scripts/performance recommendations, including image/carousel generation, trend discovery, Brand Guardian and fact-checking interfaces.
- Private voice cloning/import, cover design, B-roll/music/intro/outro, general video/audio media library and operator investigation of unknown external submissions.
- YouTube/TikTok/Meta/VK publishing and analytics adapters with official OAuth/refresh flows; production verification of HeyGen/S3/Telegram and YooKassa. Autopilot requires its own opt-in/feature gate and safety review.
- Comment inbox/reply safety modes, funnels/UTMs, complete financial/provider-cost dashboards, operator job-reconciliation workflows, extended quota policies and provider/model configuration. Versioned tariff prices and AI/video limits now have an ADMIN editor.
- Complete account-data export/deletion, remaining media/voice privacy flows, platform-wide feature-flag wiring, Sentry-compatible monitoring and provider readiness views.
- Complete development seed and final platform-wide security/architecture reviews. The full MVP browser chain is verified with fixture transports; real configured-provider end-to-end verification remains pending.
- Fresh AMD64 release images, GLOBAL/RU infrastructure placement, backups/restore drills, production credentials and complete Vercel/runtime deployment. The NL capacity upgrade and SMTP sender domain are still pending.

Implemented billing/renewal, durable encrypted email, notifications, team management, structured Brand Brain editing and the agency portfolio are documented below; their presence does not establish completion of the remaining specification.

## Source and hosting

Git remote origin: https://github.com/kredavto/contentos-ai. User selected Vercel for web/BFF. Connected Vercel team: Yuriy / digagency (team_T4Jm4ASQqZgd6ys8grG6emG4). Persistent BullMQ/FFmpeg worker requires a separate host. RU_DATA_RESIDENCY remains a separate Russian infrastructure profile.

## Next concrete slice

Continue with normalized analytics/Performance Analyst, Cover Studio and operator resolution for uncertain submissions. Additional social providers, payments and all other original requirements remain in scope. Research official APIs first.

## Local environment notes

Bundled Node: /Users/urijlebedinskij/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node. Add its directory to PATH for tools. Bundled pnpm is 11.19.0; invoke `pnpm dlx pnpm@10.30.3` for project-pinned installs. Task-owned development web server was stopped after tests. PostgreSQL 16 test container remains on 55432; the main Compose stack uses PostgreSQL 17 on 5432 and Mailpit on 1025. Application development uses port 3100; isolated E2E uses 3187 and a test SMTP sink on 1026/8026. Port 3000 is used by another local project and must not be stopped or reused.

Docker public pulls initially hung in docker-credential-desktop. Task-owned hanging helpers were stopped; public pulls succeeded using an isolated empty Docker CLI config at /tmp/contentos-docker-public with the existing Docker socket. User credential configuration was not changed. Compose stack subsequently started normally with cached images.

## Repository and dependency follow-up

- Full source pushed to GitHub main (97f41ba); CI run https://github.com/kredavto/contentos-ai/actions/runs/37195435512 passed every required step.
- CLI OAuth lacks workflow scope. Connected GitHub connector has workflow permission: initial CI file was created through it, then local history merged and source pushed normally. Future workflow edits may need connector update_file followed by fetch/merge. No user credential settings changed.
- Production dependency audit found vulnerabilities in initial Nodemailer 7. Upgraded to Nodemailer 10.0.14 (bundled types), confirmed `pnpm audit --prod`: no known vulnerabilities. SMTP registration/verification E2E re-passed in a fresh server against PostgreSQL 17 after upgrade; dedicated test port avoids unrelated projects. Follow-up committed as 7a1d85b. Generation slice pushed in main at 012616c; CI run 37196472249 passed. Local environment correction 285b683 also passed CI (37196498738).

- Consent/provider foundation df2b98f passed remote CI run 37197301005. Photo-library local verification passed 52 Vitest tests and both Playwright scenarios (including upload/preview/deletion). Browser tests now wait for the actual API route to compile, rather than only the lightweight liveness endpoint. On the 8 GiB development machine, password hashing took about 15 seconds during concurrent browser activity versus under a second in a direct HTTP check; safe phase timings were added without changing the password KDF. Run typechecking and browser tests sequentially. Turbo typecheck concurrency and Vitest worker count are capped at two to reduce memory pressure.

- Photo-library commit 82560cd passed CI run 37199129058. Avatar development now has 61 passing tests and both Playwright scenarios passed (1.4 minutes), including avatar completion/credits/deletion. The browser check exposed ambiguous select labels; explicit accessible names fixed the consent/avatar forms. Fresh production build passed (9 seconds).

- Avatar Studio commit 0ae5c7b passed remote CI run 37200140389.

- Public voice selection passed both browser tests (1.6 minutes), including persistence after reopening Avatar Studio; mobile layout inspected. FFmpeg/FFprobe 9.0.2 binaries from the macOS distributor linked by ffmpeg.org are available locally at /tmp/contentos-ffmpeg/ffmpeg and /tmp/contentos-ffmpeg/ffprobe; both version commands succeeded. They are integrated into the worker; CI installs distribution FFmpeg before media tests.


## Basic Video Factory

- Durable GENERATE_VIDEO jobs snapshot the approved script version, avatar/voice references and exact original consent evidence. Every ordered stage transition is append-only. Unknown submissions replay only with the same key inside the documented window; exhausted uncertainty holds the reservation for reconciliation.
- The persistent worker downloads provider MP4 through a restricted HTTPS/public-IP boundary, stores the original, runs FFmpeg and stores the final MP4 and JPEG cover privately. A known remote render is reused on processing retries.
- VIDEO_SECONDS reserve twice the planned duration, capped by the database policy; completion captures ceil(actual duration) and atomically releases the remainder. Database triggers prevent duplicate settlement and reservation reopening. The one-time starter grant includes configurable video seconds. Migrations through 0010 applied locally.
- Video Studio supports approved script/avatar/voice selection, three orientations, 720p/1080p, crop/contain, private playback, approval and stage history. Disabled captions/B-roll are explicitly identified. Production credentials are still unconfigured; no duplicate paid HeyGen test was sent.
- Verification: 77 unit/integration/media tests, typecheck and lint passed; both Playwright scenarios passed (2.2 minutes), including real FFmpeg, S3 fixture transport, playback metadata and approval. Mobile screenshot reviewed, with no horizontal overflow. Four additional transport-boundary tests passed, as did the production build and final lint/typecheck.

Still pending: configurable retention and operator investigation of expired unknown submissions, cover design, background music, B-roll, intro/outro, optional watermark, publishing and the remaining full SaaS scope above.


## Video lifecycle follow-up

Video deletion is now a durable lifecycle: immediate access/approval block, canceled-worker fencing, grace for in-flight writes, provider plus original/final/cover removal, retry and metadata scrubbing. Safe manager-level reconciliation resume preserves provider reference/idempotency and the replay deadline. Unknown submissions without a reference cannot falsely complete deletion. Migration 0011 adds deletion state/lease fields. All 85 tests passed, along with typecheck, lint, production build and both browser scenarios (2.2 minutes), including explicit confirmation and completed deletion of the video.

- Video Factory commit 9345c9f passed remote CI run 37201951695, including the real FFmpeg and browser workflow.


## Reviewed captions before final render

Migration 0012 adds a tenant-bound caption draft, optimistic revision/confirmation, WAITING_REVIEW jobs, source checkpoints and a separate AUTO_CAPTIONS credit reservation. Manual captions work without an external API. The OpenAI whisper-1 adapter validates timestamped segments and never retries an uncertain paid call. Uncertainty holds the job; explicit manual fallback refunds transcription credits and reuses the private original. Final rendering uses only the confirmed revision, with clean/bold ASS templates. Deletion scrubs caption text. Consent and current script approval are checked again before edit/confirmation and worker completion.

Initial checks: 92 unit/integration/media tests, lint and typecheck passed, including real WAV extraction, draft review, optimistic conflict, caption billing and unknown-response fallback. Both Playwright scenarios passed (3.1 minutes), including caption editing on desktop/mobile, actual FFmpeg burn-in, playback, approval and deletion. The test waits explicitly for the asynchronous review state (the initial 30-second click timeout was shorter than the queue redispatch interval). The production build passed. No live transcription or duplicate HeyGen generation was sent.

Video lifecycle commit 2e8e0ff passed remote CI run 37202409700.


## Editorial calendar

Migration 0013 adds tenant/brand content plans with UTC timestamps, IANA zones, revisions and creation idempotency. Day/week/month views, drag/drop and a keyboard/mobile editor cover all five requested content types. Plans can attach an approved video; creation and updates recheck the script and original consent. Captions, hashtags, desired privacy/comments and MANUAL/APPROVAL preferences are persisted. Read access is separate from verified writer mutations. Non-GET mutations now share the per-user throttle.

The calendar does not yet publish: the UI explicitly distinguishes planning from external delivery. Publishing jobs, social connections, analytics and all other outstanding SaaS modules remain required. Next: implement the real publishing connection, durable approval scheduler and status workflow; initial Telegram research is recorded in publishing-next.md.

97 tests passed; additional approved-video attachment coverage also passed. Both Playwright scenarios passed (4.0 minutes), including approved-video planning, native drag/drop, optimistic date persistence, all three views, cancellation and mobile layout. Production build, final typecheck and lint passed. Caption commit 669e43c passed remote CI run 37203378533.


## Encrypted Telegram connections

Migration 0014 adds tenant/brand social connections. The real Telegram adapter checks the bot identity, channel and administrator posting rights through getMe/getChat/getChatMember. Tokens use AES-256-GCM with tenant/brand/connection/provider authentication, versioned keys and explicit rewrapping. Safe connection summaries exclude tokens, ciphertext and external references. Manager-only connection, rights refresh, token replacement and disconnection are audited and revision-fenced; disconnect erases the saved credential. Missing or invalid vault configuration disables credential operations without taking down unrelated application features.

The Integrations tab supports these operations with explicit local-demo labeling. This slice does not send messages. Publishing approval, scheduler and remote delivery remain outstanding. See [connection configuration and security](social-connections.md).

Calendar commit 1035d34 passed remote CI run 37204057150.

Verification for the connection slice: 107 unit/integration/media tests passed, including a concurrent disconnect-versus-inspection regression. Both Playwright scenarios passed in 3.7 minutes with connection creation, empty token field after save, rights refresh, disconnect, reconnection, desktop/mobile screenshots and no horizontal overflow. No live Telegram request was made.

Production build, final workspace/test typecheck and lint passed. The final focused vault/connection regression passed all 7 tests after replacing an ES2024-only test helper with a target-compatible promise gate.


## Approval-based Telegram publishing

Migration 0015 adds immutable publishing approval snapshots and publication acknowledgements. The dedicated BullMQ queue uses database eligibility, lease fencing, bounded preparation retries, cancellation before send and recovery of lost delivery. Telegram text and multipart MP4 adapters are real; current channel rights/visibility/discussion settings, exact calendar revision, approver permissions, video/script approval and original consent are rechecked before the durable send marker. Missing configuration disables publication. Unknown external outcomes are held for reconciliation without replay. Pending jobs are canceled on credential replacement/disconnection.

The Publishing tab supports plan/channel review, private video preview, explicit approval, scheduled status, cancellation and saved acknowledgement. The calendar prevents edits to frozen publication revisions. See [publishing design and boundaries](publishing.md). Manual operator resolution, additional platforms, analytics and full deployment remain required.

Initial verification: 117 tests passed across 25 files; workspace/test typecheck and lint passed. Additional video-publication consent-revocation and safe social-summary regressions passed (15 tests). Existing cleanup tests were isolated from previous runs' provider fixtures and made independent of host/database clock skew.

Encrypted-connections commit f7f7bf3 passed remote CI run 37205056767.

Both browser scenarios passed in 4.4 minutes, including scheduled video delivery through the real BullMQ/storage pipeline with the explicitly mocked remote sender, saved publication status, mobile overflow checks and desktop/mobile visual review. The browser run exposed a calendar refresh race: controls now remain pending until refreshed rows arrive, and outdated responses cannot overwrite newer data. No live Telegram message was sent.

Final publishing verification: 118 tests in 25 files, production build, final workspace/test typecheck and lint passed. The published acknowledgement uses the same explicit timezone as the schedule.

## Manual publication analytics

Migration 0016 adds immutable, tenant-scoped publication observations with all twelve normalized metrics, explicit nulls, MANUAL provenance, source note, author and observation/recording times. Managers can record a full observation or correction idempotently; histories cannot be overwritten. The Analytics tab displays recent publications, latest observations and bounded history with browser-timezone input, clear demo labels, empty/error/loading states and no fabricated zeros or summation across snapshots. See [analytics scope and remaining provider work](analytics.md).

Automatic FETCH_ANALYTICS, channel metrics, raw provider payloads and AI recommendations are not implemented by this slice. Payments, additional workflows and deployment remain outstanding. Publishing commit 4cafeb7 passed remote CI run 37206257515.

Verification: all 124 tests across 26 files passed with PostgreSQL and real FFmpeg enabled. The final analytics/publishing regression passed 13 tests, including zero/null semantics, invalid values, time bounds, immutable history, concurrent idempotency and real organization/brand isolation. Both Playwright scenarios passed in 5.6 minutes, including manual observation entry, persistence after reload, history, desktop/mobile screenshots and no horizontal overflow. The initial browser run exposed an exact-label lookup issue in the new publication selector; an explicit accessible label fixed it. No live Telegram request was made.

Final production build, workspace/test typecheck and lint passed after the browser fix and Unicode source-note validation.

## Background channel membership analytics

Migration 0017 adds durable FETCH_ANALYTICS jobs, immutable channel membership observations and separate numeric provider evidence. The real Telegram adapter uses getChatMemberCount. Collection is requested in Analytics and executed by a dedicated BullMQ worker with database delivery recovery, bounded retries, leases, cooldown, provenance, role rechecks and credential-generation fencing. Disconnect/reconnect cancels pending reads and rejects their late responses. The UI separates whole-channel counts/history/deltas from manual publication metrics and labels all demo observations. See [workflow, configuration and remaining analytics work](channel-analytics.md).

Recurring collection, other providers, automatic publication metrics and AI recommendations remain outstanding; this slice does not complete the overall MVP or deployment.

Verification: all 135 tests across 28 files passed with real PostgreSQL and FFmpeg. New adapter/integration coverage includes measured zero, invalid responses, safe error classification, immutable evidence, tenant/brand isolation, idempotency, cooldown, bounded retries, stale leases, disconnect/token replacement and role withdrawal. Both Playwright scenarios passed in 5.0 minutes, including the dedicated queue, labeled demo observations, channel history, manual publication metrics, persistence and mobile overflow checks. Desktop/mobile screenshots were reviewed. No live Telegram API request was made.

The first browser run exposed a pre-existing consent-form race: controls could be changed while a refresh was pending, then a delayed state reset cleared the user's confirmation. Pending controls are now disabled and the reset happens at operation start. The complete browser rerun passed. Prior manual-analytics commit 96dcf75 passed remote CI run 37212147587.

Final production build, workspace/test typecheck and lint passed after the consent-form fix.

## Performance analysis engine foundation

The AI package now validates a bounded publication-evidence snapshot and produces a structured report across all seven required performance dimensions, plus typed strategy experiments. It reuses the real configured LLM adapter and existing metered repair/fallback engine. Validation rejects invented citation IDs, missing metrics, mixed provider/source comparisons, incompatible observation ages and audience-response claims without measured breakdowns. Explicit DEMO fixtures remain development-only. See [implemented boundaries and remaining integration](performance-analysis.md).

This is not yet a complete user-facing slice: the durable OPTIMIZE_STRATEGY job, evidence repository, report/recommendation persistence, acceptance/rejection API and Analytics interface remain to be connected. No strategy or Brand Brain is changed by the engine; no live paid AI request was made. The full MVP and Vercel deployment remain outstanding.

Verification: all 153 tests in 29 files passed against PostgreSQL with real FFmpeg enabled. Eighteen new tests cover evidence/provenance/time/zero-null rules, bounded typed patches, production-safe mock behavior, metered semantic repair, repair exhaustion and missing configuration. Existing generation workflows pass through the shared engine unchanged.

Final workspace/test typecheck, lint, production build and whitespace validation passed. Browser tests were not rerun locally for this engine-only change; no UI, routes or database migrations changed.

## Durable AI reports and recommendation review

Migrations 0018–0020 connect OPTIMIZE_STRATEGY to the existing durable generation queue and immutable credit ledger. The enqueue transaction snapshots recent publication evidence, the current strategy and Brand Brain revision. Worker/cache/completion validation uses this same input. Reports, recommendations and decisions are tenant-scoped and append-only. Acceptance creates a new strategy version; conflicting strategy/brand changes are rejected, while disjoint accepted fields from the same report can be applied sequentially. Brand Brain is not changed. The feature defaults off via ANALYTICS_AI_ENABLED on both web and worker.

Analytics now includes report generation, coverage/source details, seven findings, experiment measurement rules, before/after field previews and explicit acceptance/rejection. The database sets credit cost. This supersedes the preceding engine-only integration limitation. No live external AI or Telegram request was made. See [workflow and remaining limits](performance-analysis.md).

Initial verification: all 162 tests across 30 files passed with real PostgreSQL and FFmpeg. New integration tests cover frozen observations, immutable history, manager/tenant/brand isolation, concurrent idempotency, single capture, stale leases, withdrawn permissions, refunds, acceptance/rejection and strategy conflicts. Workspace/test typecheck, lint and production build passed. Browser verification is in progress; full MVP and production deployment remain outstanding.

Local browser attempts stopped before reaching the new feature because resource pressure delayed registration (36 seconds) and cold onboarding compilation/navigation (over 30 seconds). Authentication waits now allow 60 seconds without weakening password hashing. The homepage passed agent-browser rendering/error checks. The complete browser scenario is being verified in an isolated CI runner before merging this slice. The preceding engine commit ad1d930 passed full remote CI (37214839876).

Isolated CI reached the generated performance report and exposed an accessible-name issue in the report selector: the option text was included in its implicit name. Explicit labels now identify both analysis selects. The report was generated through the queue successfully; acceptance/rejection and visual verification are being rerun after the fix. CI now retains browser screenshots on successful runs as well as failures. Final local typecheck, lint and production build also passed.

Final verification supersedes the pending checks above: [CI run 37216727705](https://github.com/kredavto/contentos-ai/actions/runs/37216727705) passed for exact head 00700b4, including typecheck, lint, 162 tests, production build and both Playwright scenarios in 4.2 minutes. Browser coverage confirmed report generation, explicit acceptance creating strategy version 2, rejection, persisted decision history after reload, unchanged Brand Brain and no mobile horizontal overflow. Final desktop/mobile screenshots were reviewed. [PR #1](https://github.com/kredavto/contentos-ai/pull/1) was merged into main as 8c13c2a. Full MVP implementation and Vercel/worker production deployment remain outstanding.

## Subscription billing foundation (in progress)

The payment slice now has a documented consistency design in [payments.md](payments.md) and strict settlement identity/money schemas. A settlement predicate requires a paid successful observation matching provider, external/internal order IDs, merchant, test/live mode, exact amount and currency. Exact RUB decimal conversion rejects rounding and malformed values. Monthly boundaries preserve the original UTC anchor day across short months. Six focused tests passed. These helpers are not yet wired to a provider or ledger: checkout, durable payment tasks, webhook verification, subscriptions, renewal consent and UI remain under implementation. No charge or production payment connection has been made.

Foundation verification: all 168 tests across 31 files passed with PostgreSQL and real FFmpeg, plus workspace/test typecheck, lint and whitespace checks. No UI or runtime payment wiring changed, so browser tests were not rerun for this foundation. Work is isolated on codex/subscription-billing until the payment flow is implemented and verified.

## YooKassa provider adapter (billing integration in progress)

The real server-side YooKassa v3 adapter now supports redirect checkout, saved-method renewal, payment reads, full/partial refunds and refund reads. It validates returned identity/merchant/mode/money, uses exact RUB amounts, drops raw card information, retains receipt status, restricts return/confirmation URLs, bounds response size/time and never retries internally. Mutations refuse replay after a conservative 23-hour window. Verified rejections and uncertain outcomes are distinct. Configuration defaults off and rejects production test mode. Official provider sources and remaining fiscal scope are documented in payments.md.

All 178 unit/integration/media tests passed with PostgreSQL/FFmpeg; typecheck, lint and production build passed. A final documentation cross-check refined full versus partial refund receipt handling; focused regression and final checks follow. No real external payment request was made. Durable orders/subscriptions, webhook receipts, worker dispatch, atomic ledger settlement and Billing UI still need implementation before this adapter can be enabled for users.

Final adapter verification: all 16 focused payment/adapter regressions passed after the full/partial refund and malformed-URL fixes. Final workspace/test typecheck, lint and production build passed. The broader 178-test suite passed before these final localized refinements. No browser scenario was rerun because no UI, route or worker wiring changed in this adapter-only step.

## Billing persistence foundation (in progress)

Migration 0021 adds five billing tables (62 total): disabled plan catalog, immutable prices, tenant orders, unique external payment mappings and immutable settlements. Verified owners can create idempotent current-price orders through the internal repository. Worker-only settlement validates paid evidence and atomically grants AI credits/video seconds once, with audit and rollback on failure. PostgreSQL guards reject cross-tenant or mismatched identities and history mutation. Ledger balance aggregation now supports totals beyond int32 while rejecting values outside JavaScript safe integer range.

The seven billing integration tests and six existing ledger tests passed against PostgreSQL, including concurrent checkout/settlement, changed intents, stale quotes, wrong merchant/mode/amount, cross-tenant access, duplicate external payment, atomic rollback and large balances. Initial typecheck/lint passed; full final verification is running. No routes or worker tasks enable billing yet. Subscription terms, renewal consent, webhook/task persistence, plan changes and UI remain required; full MVP and deployment are not complete.

Final persistence verification: all 185 tests across 33 files passed, plus workspace/test typecheck, lint, production build and whitespace checks. Migration 0021 was applied successfully to the dedicated PostgreSQL test database. All payment provider tests used explicit HTTP fixtures; no real payment was requested.

## Paid subscription terms

Migration 0022 adds subscription identities and immutable paid monthly periods (64 tables total). Settlement now commits the paid period together with credit grants. Prepaid periods retain the original UTC day across February; an expired subscription restarts from the new payment's processing time. An owner-only overview separates active, upcoming and historical periods without receipt/provider secrets. PostgreSQL verifies paid-order/plan identity, monthly boundaries and non-overlap. Existing settlement replay can restore a missing historical term without regranting resources.

All 188 tests passed, along with workspace/test typecheck, lint and production build. This includes prepaid month boundaries, current/future selection, expiry gaps, historical replay and transaction rollback. An additional direct-insert overlap guard regression is being verified. CI run 37218738525 for the preceding persistence commit reached the browser scenarios; completion has not yet been asserted. Renewal consent/cancellation, payment dispatch/webhooks, plan changes and Billing UI remain outstanding; payments are still disabled.

Final term verification: all 17 focused billing/ledger tests passed after adding the direct PostgreSQL overlap regression, and test TypeScript compilation passed. The preceding full run passed 188 tests; production code was unchanged after that run. Migration 0022 applied successfully to the dedicated test database.

## Renewal permission and cancellation (in progress)

Migration 0023 adds three renewal tables (67 total). Verified owners can preview and accept an exact current-price policy, or cancel future renewal permission through the internal repository. Consent/change history is immutable. Tenant locks and revisions fence competing requests; replaying old enable/disable intents cannot reverse a later choice. Cancellation preserves paid periods and credits. Overview excludes request IP/user-agent evidence.

Initial tests passed five scenarios and exposed a nondeterministic test assumption about which racing request won; the assertion now uses the actual winning request. Full verification is running. Checkout still uses saveMethod=false and no billing worker/route invokes this permission flow. Binding consent to checkout, encrypted saved methods, cancellation of queued charges, automatic scheduling and UI remain required.

Final renewal verification: all 195 tests across 34 files passed, plus workspace/test typecheck, lint, production build and whitespace checks. Six new integration scenarios cover exact policy acceptance, concurrent idempotency, preserving paid access on cancellation, old-intent replay after later choices, revision races, stale quotes, role/tenant isolation and immutable history. Migration 0023 applied to the dedicated test database. No live payment request or automatic charge was made.

## Consent-bound checkout and encrypted payment methods

Migration 0024 binds saving checkout to the exact active renewal consent/revision and adds encrypted saved methods (68 tables total). Worker-only capture requires a matching paid settlement and current verified owner. AES-GCM associated data separates payment references from social credentials and binds tenant/order/provider/merchant/mode. Cancellation and replacement consent erase usable ciphertext atomically; concurrent capture cannot undo revocation. Default checkout does not request method saving.

All 201 tests across 35 files passed with PostgreSQL and FFmpeg, plus workspace/test typecheck, lint, production build and whitespace checks. Migration 0024 applied to the dedicated test database. New coverage includes consent-bound replay, capture before settlement, identity mismatch, encrypted replay, cancellation races, replacement consent, database resurrection rejection and missing-vault/owner checks. No real payment request was made. Queue dispatch, authenticated webhook reconciliation, renewal scheduling, plan changes, Billing UI and production deployment remain outstanding.

## Durable checkout task and worker

Migration 0025 adds payment tasks/outbox (69 tables total) committed with new orders. The worker now dispatches a dedicated BullMQ payment queue. Leases fence duplicate/stale workers; the committed send marker freezes the original timestamp and internal UUID key. Unknown payment replay stops at five sends or 23 hours. Authenticated payment mappings are persisted before settlement, so later processing uses GET. Cancellation/replacement consent cancels unsent tasks atomically and cannot erase an uncertain send. Automatic renewal orders remain disabled pending saved-method binding and scheduling.

All 212 tests across 36 files passed with PostgreSQL/FFmpeg; workspace/test typecheck, lint and production build passed. The new outbox test initially exposed raw SQL timestamp encoding, which was corrected before the passing run. Migration 0025 applied successfully. An additional regression for saved-method write failure after paid settlement is being verified. Real payment transport is mocked in these tests; no charge was requested. Checkout/webhook UI endpoints, webhook reconciliation, renewal scheduling, plan changes and production deployment remain outstanding. Latest remote/browser CI evidence is separate from these local checks.

Final task verification: all 12 focused payment-task regressions passed, including recovery from a method-write failure after settlement using GET with one payment and one set of ledger grants. Test TypeScript compilation and focused lint passed after adding that regression. The preceding full suite passed 212 tests; production code was unchanged after that run. Remote/browser CI for this new worker integration has not yet been asserted.

## Durable payment webhook verification

Migration 0026 adds the webhook receipt journal/outbox (70 tables total), and `/api/webhooks/yookassa` acknowledges only durable acceptance. The worker performs authenticated object lookup, resolves tenant/order from that result, validates the exact payment identity/amount and reconciles lost responses without another POST. Raw notification status, amount, order hints and card fields cannot grant access. Duplicates, stale leases, bounded retries and late redelivery are handled. Pending objects behind a claimed paid event stay retryable.

The real-adapter processor regression exposed missing merchant/mode metadata on status GET; this was fixed and is now covered beyond interface mocks. All 33 focused adapter, route and task/webhook tests passed, together with workspace/test typecheck and lint. Migration 0026 applied successfully. Full regression suite and build are running. No real payment was made. Checkout/status UI routes, recurring scheduling/method binding, plan changes, Billing UI and production deployment remain outstanding.

Final webhook verification: all 224 tests across 37 files passed with PostgreSQL/FFmpeg, and production build passed. Typecheck and lint also passed for this code. Route tests verify acknowledgement ordering, non-acknowledgement of persistence errors, body limits and configuration/rate-limit responses. Remote/browser CI for this commit is not yet asserted.

## Owner billing API and checkout screen

Added verified-OWNER catalog/overview, checkout, safe order status and renewal cancellation endpoints under the organization boundary. Checkout accepts only quote ID and intent key; server configuration supplies fiscal settings/return origin and verified owner data supplies receipt email. Configuration defaults remain closed. The Billing screen resumes orders, preserves retry intent, shows provider confirmation/polling and paid periods/history, and links from the owner workspace. Automatic renewal enablement remains unavailable.

Both new browser scenarios passed locally in headless Chrome: real authenticated disabled-state/tenant/CSRF checks, and explicitly intercepted UI fixtures for retry-key preservation, pending confirmation, paid state and a new purchase intent. Desktop/mobile screenshots were reviewed and no horizontal overflow was found. No real payment was requested. The first local launch found a missing Playwright Chromium version; the installed Chrome channel was used. Browser testing also exposed DomainError class identity across Next hot reload, causing 500 instead of 403. Domain errors now carry a private global-symbol brand, with a reload regression and no broadening of ProviderRequestError recognition. Full type/lint/unit/build checks are running.

Automatic saved-method renewal scheduling, upgrades/downgrades, provider-configured payment end-to-end browser coverage, production configuration and Vercel/worker deployment remain required. The new payment UI fixtures are not evidence of a real charge or a complete production payment setup.

Remote evidence for the preceding webhook commit: CI run 37220937830 completed successfully for exact head 31796af460fa01d4982626d36a2ffe888050bd8b, including its browser stage. This does not substitute for checks of the newer Billing UI changes.

Final Billing verification: all 228 tests across 38 files passed with PostgreSQL and real FFmpeg, workspace/test typecheck and lint passed, and production build passed. Both new Billing browser scenarios passed in local Chrome, with desktop/mobile screenshots reviewed. The broader existing MVP browser scenarios were not rerun locally in this step; the next PR CI run covers all four browser tests. The task-owned development server and browser were stopped. No real payment, deployment or automatic renewal was performed.

## Recurring worker engine and immutable method binding

Added a gated recurring scheduler, one immutable intent per paid term, encrypted-method hydration only at provider submission, and pre-send owner/consent/method/plan/term checks. Consent-frozen prices survive later catalog changes. Cancellation and manual prepayment block unsent stale tasks. Recovery is bounded to 72 hours after the latest term; no catch-up series is generated. A calendar review found that small February processing delays would otherwise reset the monthly anchor; automatic settlement now preserves the original anchor within the recovery window.

Migrations 0027–0028 add renewal intents and plaintext/mode guards (71 tables). The initial generated migration put a foreign key before its required unique constraint; application failed and rolled back. Database inspection confirmed only 27 prior migrations and no new table before correcting the unapplied SQL ordering. Both additive migrations then applied successfully. No previously applied migration was edited.

The initial 24 focused payment/task/webhook tests passed with four new recurring scenarios. Additional direct database guard and January-31 boundary regressions are being verified along with the final type/lint/full-suite/build checks. PAYMENT_RENEWALS_ENABLED remains false by default. Opt-in/saving-checkout UI, method readiness/recovery messaging, plan changes and deployment remain required; no real charge was made.

Remote evidence for the preceding Billing UI commit: CI run 37222525012 succeeded for exact head 380be8af6ce711f40374c58e1270cae05965d056, including all four browser scenarios. This is distinct from verification of the newer recurring engine.

Final recurring-engine verification: all 234 tests across 38 files passed with PostgreSQL and real FFmpeg, including 26 payment-task/webhook scenarios. Workspace/test typecheck and lint passed; production build succeeded (the final invocation reused the matching Turbo build cache). The additional regressions verify PostgreSQL rejection of plaintext/unbound recurring orders and preservation of a January-31 anchor through a late February renewal. Whitespace checks passed. External payment responses were fixtures; no live charge, new browser run or deployment was performed in this step. The feature remains off by default and new opt-in remains unavailable in the UI.

## Explicit renewal opt-in and method readiness

Connected owner policy preview/acceptance routes and consent-bound saving checkout to Billing. The checkbox starts unchecked, ordinary purchase remains separate, and retries retain consent and checkout intent keys. Overview exposes only merchant-scoped method readiness and the next paid-term boundary, without credentials. Added integration coverage for exact acceptance, stale/canceled consent, configuration/role denial and method readiness after capture/cancellation.

Local browser testing initially found a test selector matching both the application error and Next's route announcer; the selector now targets the expected message. The focused opt-in scenario passed, including simulated consent and checkout response failures. Final browser/type/lint/full-suite/build checks are in progress. External payment responses remain explicit fixtures; no real charge or deployment was performed.

All three local Billing browser scenarios passed in Chrome after the selector correction; desktop/mobile consent screenshots were reviewed with no horizontal overflow. The task-owned dev server was stopped. CI run 37224184669 also completed successfully for the preceding recurring-engine commit 9e3d371a9fe4a627d979fe000aad37df460bcafb. That remote evidence is separate from the newer opt-in changes.

Verification resumed on 2026-10-09 after temporary logs/binaries had disappeared. Docker PostgreSQL retained all 29 migrations. Typecheck/lint passed again and all 29 focused payment scenarios passed. FFmpeg/FFprobe 9.0.2 were restored from the macOS distributor linked by ffmpeg.org. The initial full run had two existing media-processing timeouts under parallel load; a serial run passed both but exposed an immediate-cleanup test's dependence on application/database clock alignment. The fixture now explicitly makes its queued deletion due on the database clock before claiming it, as it already did for the retry. Production deletion timing is unchanged. Final serial verification is running.

Final opt-in verification: all 237 tests across 38 files passed serially with PostgreSQL and real FFmpeg; production build passed. Workspace/test typecheck and lint passed, with the subsequent test-only clock fix checked separately. Three Billing browser scenarios passed in local Chrome earlier for this UI, including unchecked opt-in and stable keys across both simulated failure stages. No real payment or deployment was made. Upgrade/downgrade flows, configured-provider end-to-end coverage, recovery notifications, production configuration and deployment remain outstanding.

## Confirmed monthly plan changes

Added owner purchase preview and explicit next-period upgrade/downgrade confirmation. Orders bind the displayed last paid term; PostgreSQL verifies direction, target quote/resources and tenant ownership. Stale previews are rejected, stale unsent changes canceled, and already-submitted payments remain reconcilable without overwriting paid history. Current/upcoming plan names and consent/plan mismatch are visible in Billing. The product policy preserves prepaid periods; immediate prorated upgrades are not implemented.

Migration 0029 applied to the test database (30 migrations, 71 tables). The new cyclic financial foreign key needed an explicit Drizzle extra-config return type to retain strict inference. Five focused integration tests passed in an isolated per-suite database; an initial cross-tenant assertion was corrected to expect the existing NOT_FOUND non-disclosure response. Browser and full checks are running. No live payment was made.

Final monthly-change verification: 242 tests across 39 files passed serially with PostgreSQL/FFmpeg; workspace/test typecheck, lint and production build passed. Four Billing browser scenarios passed in Chrome, and the added downgrade scenario was rerun for reviewed desktop/mobile screenshots with no overflow. The dev server was stopped. The new test database is created/migrated/dropped per suite and does not modify other suites' global plan catalogs. No real charge, refund or deployment occurred.

## Durable in-app notifications

Migration 0030 adds notification receipts and recipient inboxes (73 tables, 31 migrations). The worker projects durable audit/payment/term facts every five seconds. Receipt insertion and recipient creation are atomic; concurrent retries cannot duplicate a delivery. Static text avoids copying private audit/provider payloads. Current membership and audience permissions are rechecked on every read and acknowledgement; former owners lose financial visibility. Keyset pagination preserves PostgreSQL timestamp precision.

The notification page includes unread counts, read acknowledgement, pagination, refresh/error/empty states and links to the corresponding brand studio tab or billing page. Six dedicated integration regressions and existing publishing/social workflow assertions passed (20 focused tests total). The real-database Chrome scenario passed, including CSRF, foreign-tenant denial, persisted read state and role changes. Desktop/mobile screenshots were reviewed without horizontal overflow. Full workspace checks are in progress. This slice delivers in-app notifications; asynchronous email delivery is the next outstanding reliability task. No live external message or deployment was performed.

Final notification verification: all 248 tests across 40 files passed serially with PostgreSQL and real FFmpeg. Workspace/test typecheck, lint and production build passed. The dedicated notification browser scenario passed in Chrome; its desktop/mobile screenshots were reviewed. Task-owned browser/dev processes were stopped. Production deployment and remaining product modules are still outstanding.

## Encrypted authentication email outbox

Migration 0031 adds `email_outbox` (74 tables, 32 migrations) and a composite auth-token reference. Registration/token replacement commits encrypted email and hashed bearer token together. The HTTP path no longer depends on an SMTP response; the persistent worker delivers with leases, bounded exponential retry and stable Message-ID. It cancels superseded/expired/disabled-account links and erases message payloads on terminal states. SMTP recovery is at-least-once: uncertain acknowledgements can repeat the same link, never create a new token. Identity and terminal delivery are guarded in PostgreSQL; encryption AAD binds each message to its user and ID.

Eleven identity/outbox integration tests passed. The first new fixture run exposed incorrect direct-SQL JSON parameter encoding in two test mutations; encoding was corrected and both regressions passed. Workspace/test typecheck and lint passed. Full browser and regression validation are in progress. Web and worker now require matching encryption keys plus SMTP readiness for registration/reset. A local setup script generates a private key in ignored `.env` without exposing or replacing it.

Vercel infrastructure inspection found no existing CONTENTOS project. Created project `contentos-ai` (`prj_KMzoSu8fmoWhhWqTFWFG4lc0hpEB`) under authorized team digagency, linked to the authorized GitHub repository with root `apps/web` and Node 24. No deployment was triggered. Production database/Redis/S3/SMTP and the persistent worker host are still unconfigured; the user was asked whether existing infrastructure is available while implementation continues.

Remote verification: CI run 37850214258 succeeded for notification commit `0d4817f9a6b04e1b0ec2d22b1b1bdf1eb9d61f38`, including its browser stage. This does not substitute for validation of the newer email changes.

Final email verification: all 253 tests across 41 files passed with PostgreSQL and real FFmpeg; workspace/test typecheck, lint and production build passed. All seven Playwright scenarios passed in installed Chrome, including the full registration → queued SMTP verification → onboarding → strategy/ideas/script → avatar/video/captions → approval/scheduled publication → analytics/recommendations chain, plus Billing and notifications. SMTP/storage/provider transports were local fixtures, not real external sends or charges. The lint pass required explicit Node imports in the new local-key setup script; that was corrected before the final passing run. Browser/web/worker fixture processes were stopped by Playwright and the separate inspection browser was closed.

First Vercel staging deployment reached READY for email commit `e3f3c043386c9ab9f28d4fce7b7fe0a55690f130`: https://contentos-54l7vlhlu-digagency.vercel.app (`dpl_BNU3bMVcorBgwyPDFrPS8XvRRERk`). Chrome showed the real home page; health returned 200, registration HTML 200, and account API returned the expected safe CONFIGURATION_REQUIRED 503. No runtime credentials or database were fabricated. Initial automatic production deployment was canceled; the UI confirms `main` production tracking. Production worker/data/provider setup and remaining modules are still required.

## Deployable container profiles (verification in progress)

Added pinned Node 24 multi-stage worker/web images, production-only worker dependencies with frozen lockfile, an explicit tsx runtime dependency, FFmpeg/FFprobe/fonts, non-root execution, context secret exclusions and GLOBAL/self-hosted release compose settings. An initial legacy pnpm deployment stage was replaced because it re-resolved dependency ranges; the final worker uses the committed dependency graph directly.

Worker image built successfully. Its offline, read-only, non-root smoke check passed actual video normalization, Cyrillic captions, JPEG cover and PCM extraction, and verified no `.env` or development test runner was included. The image applied all 32 migrations to a newly created isolated test database, then started with an isolated Redis in production mode; health returned 200 and logs contained no error. Web image and graceful shutdown checks are still in progress. No production data service or worker host has been provisioned.

Remote CI run 37851537944 succeeded for email commit `e3f3c043386c9ab9f28d4fce7b7fe0a55690f130`, independently of these newer packaging changes.

Container follow-up: worker SIGTERM shutdown returned exit code 0. Frozen workspace installation, workspace/test typecheck and lint passed after promoting tsx to a worker runtime dependency; the lockfile changed only that importer reference, without package upgrades. Web dependency download took about six minutes on the local connection; production build is now running.

Final container verification: the Linux ARM64 web image built successfully, including Next TypeScript checks and static generation. A production-mode, non-root, read-only container with the compose-equivalent init process passed home/registration rendering, all nine referenced CSS/JavaScript assets, health, anonymous rejection and a database lookup for a well-formed unknown session. SIGTERM stopped it with code 143 without forced kill; the smoke runner initially expected only code 0, then corrected that expectation and repeated the check with init enabled. Worker shutdown had returned 0. Isolated PostgreSQL database, Redis container/network and temporary environment file were removed; existing development services were preserved. The new web smoke script passed lint. No production backend was deployed.

The user authorized their existing NL server for backend infrastructure. SSH host/user details are pending; no configured SSH alias was found locally. Inspect existing services and capacity before deployment. NL is the GLOBAL placement, not RU_DATA_RESIDENCY. Team/invitation management and the other outstanding product modules remain unfinished.

## Team membership and invitations

Added verified owner/admin management, restricted role assignment/removal, explicit ownership transfer and email-bound seven-day invitations. Tenant locks serialize mutations. UUID membership revisions prevent stale actions after role changes and after removal/rejoining. Invitation links carry the bearer in the fragment; database stores its hash and a tenant/invitation-bound encrypted envelope for idempotent replay. Acceptance rechecks the recipient and issuer's current authority and never overwrites an existing role. Accepted/revoked envelopes are erased; identity and terminal states are immutable in PostgreSQL.

Migration 0032 adds team invitations (75 tables, 33 migrations). The initial unapplied draft used integer revisions; it was regenerated before any application with UUID revisions to prevent old requests matching a newly recreated membership. The final migration applied to the isolated integration database and main test database. Initial six team plus four credential tests passed. Added expiry/disabled-user coverage, team/join UI, Origin-protected API routes and a browser workflow; full validation is running. A dashboard link now selects the invited organization after acceptance, including users with existing organizations. No external invitations were sent.

Infrastructure: container commit b79de657d87f5afd52d958c30f479192c37d62c2 was pushed; GitHub CI 37854326989 succeeded. Its Vercel preview dpl_5jmJx55RC9fKAbX4oQRr9rtxRkjV reached READY at https://contentos-637b1dl11-digagency.vercel.app. HTTP home/health returned 200; account API still honestly returns CONFIGURATION_REQUIRED. SSH to the user's NL server succeeded with the existing matching key. Read-only inventory found Ubuntu 24.04, 2 CPUs/4 GB RAM, many existing applications, ~700 MB available RAM, ~3.2 GB swap used and 8.3 GB disk free. No server services were changed. The owner chose to increase resources; deployment waits for sufficient measured capacity.

Final team verification: all 263 tests in 42 files passed, including ten team integration scenarios and concurrent ownership transfers. Removing/demoting an issuer permanently revokes invitations outside their remaining authority, preventing old links from reviving after rejoining. Workspace/test typecheck, lint and production build passed. All eight Playwright scenarios passed in installed Chrome (8.7 minutes), including the full MVP chain and the new two-account team workflow. Final desktop/mobile team screenshots were inspected with no horizontal overflow. Playwright stopped its web/worker/fixture servers. Production backend and mail remain unconfigured; the operator selected a server resource upgrade and has no SMTP provider yet. A compatible Resend setup was documented; domain/DNS details are pending. No external invitation, SMTP message or paid provider request was made.

## Completed Brand Brain profile editor

A completed brand now has a profile/voice editor for OWNER, ADMIN and MANAGER members. The new strict API checks current account verification, membership, tenant scope, completion and revision under database locks. Concurrent stale writes fail with CONFLICT. Product/audience/pillar identities are preserved, voice is updated in place and new AI requests read the updated normalized context. Existing queued snapshots and strategy/script versions remain intact. Audit metadata contains revision numbers, not profile text. Editing all structured entity lists remains outstanding.

Verification: 266 tests across 43 files passed with PostgreSQL and real FFmpeg; workspace/test typecheck and lint passed. The new Chrome scenario passed after fixing textarea label markup, covering reload persistence, stale-save rejection and mobile overflow. Desktop/mobile screenshots were inspected. Production build passed. Existing eight browser scenarios were verified on the preceding team commit; the added profile scenario is the ninth. No paid AI or live SMTP request was made. NL resources were rechecked and remain 4 GB RAM / 2 CPU / 8.2 GB free disk, so deployment of the new stack is still awaiting the operator's upgrade.


## Structured Brand Brain collections

All required normalized collections can now be read and explicitly edited after onboarding: products, audiences, pains, desires, objections, competitors, positioning, pillars, offers, lead magnets, CTAs, rules and references. Writes share the brand revision and tenant lock, require a currently verified OWNER/ADMIN/MANAGER, reject foreign/archived/duplicate IDs and preserve mandatory lists. Removed entries receive archived_at instead of being deleted; downstream references remain valid. New AI snapshots filter archives and include the additional collections. Old queued snapshots and draft onboarding retain compatible schemas. Migration 0033 adds archival timestamps and is applied to local development/test databases.

Verification: 269 tests in 43 files passed with PostgreSQL and FFmpeg, including collection mutations, archival retention, permissions, concurrency and actual provider prompt context. Final workspace/test typecheck and lint passed. The full MVP browser chain and CSRF scenario passed (5.1 minutes including the initial profile-test locator failure); the corrected profile/collection scenario then passed independently in Chrome (24 seconds). The locator was narrowed to distinguish the profile success message from the collection loading status. Mobile collection rendering was inspected with no horizontal overflow. Production build passed. No live paid provider calls occurred.


## Agency client portfolio

A gated Clients page supports explicit owner opt-in, atomic/idempotent client-organization creation, linking organizations owned by the actor, and revision-safe portfolio archiving/restoration. Clients remain separate tenants with independent membership, ledgers, subscriptions, brands and provider connections. Portfolio queries join current direct client membership; agency membership alone grants no client data access. Existing organizations remain usable after portfolio mode is disabled. The deployment gate defaults off. Migration 0034 adds tenant feature flags and immutable-identity client relationships, applied locally. See [agency workflow](agency.md).

All 275 tests in 44 files passed with PostgreSQL and FFmpeg, including six focused agency integration scenarios. Workspace/test typecheck and lint passed. Agency and team Chrome scenarios passed; the agency browser test was then strengthened to wait for the client brand list before cleanup. The strengthened agency scenario passed in Chrome (47 seconds), including a successful client-data fetch after mode was disabled. Final desktop/mobile screenshots were inspected with no horizontal overflow. Production build passed. Local development PostgreSQL confirms 35 applied migrations and 77 public tables. No external email, account invitation or paid provider operation was performed.


## Platform operator console foundation

A separately provisioned platform operator can access 15 allowlisted operational views: users, organizations, jobs/failures, subscription terms, plan versions, ledger, webhooks, social status, AI call costs/models, tenant flags, audit headers, mail delivery, payment tasks and support actions. Output projections exclude credentials, hashes, payloads, job inputs/outputs and arbitrary audit metadata. Successful reads are audited. Unknown costs remain null; configuration presence is not presented as measured provider health.

The deployment gate defaults off; an enabled verified user also needs an unrevoked SUPPORT/ADMIN operator record. Tenant ownership never grants platform access. Host-only provisioning is audited and uses explicit UUID/role/ticket arguments. The console can revoke ordinary-user sessions with actor-bound idempotency, a reason/ticket, current role checks and atomic result/audit persistence. Retries do not revoke later logins. Operator accounts are excluded from this support action. Migration 0035 adds operator/action records and update-protects action results. Real users were not granted operator access. See [admin scope and provisioning](platform-admin.md).

Verification: 281 tests in 45 files passed with PostgreSQL and FFmpeg, including explicit CLI provisioning, denied tenant owners, bounded projections/pagination, unknown costs, concurrent/replayed support requests and current account/role checks. The initial isolated test fixture's timestamp encoding was corrected before the passing run. Final workspace/test typecheck, lint and production build passed. The Chrome operator scenario passed (43 seconds), covering denied tenant-owner access, guarded navigation, safe user filtering, CSRF denial, actual session invalidation and action history. Desktop/mobile screenshots were inspected; wide tables scroll within their panel without page overflow. A final six-test regression also passed after linking audit metadata to the immutable action ID. Development PostgreSQL confirms 36 migrations and 79 tables. No paid provider requests or external messages were sent.


## Platform tariff publishing

- Added ADMIN-only price/resource/availability publication with strict validation, optimistic version checks, plan-row checkout fencing, actor-bound idempotency and atomic audit. SUPPORT remains read-only.
- Every edit creates an immutable version; existing orders, paid periods and renewal consents retain their price and resource snapshots. Disabling also prevents scheduling new automatic renewals, but preserves already-created payment intents.
- Added a Russian operator form with units, explicit review, retry-safe intent, reload and conflict handling. Prices in test databases are synthetic; no real paid catalog or provider transaction was configured.
- Migration 0036 adds immutable operator pricing evidence. Production infrastructure/SMTP/provider credentials and the broader remaining modules are still outstanding. See [operator details](platform-admin.md).

Validation for tariff publishing: 287 tests across 46 files passed with real PostgreSQL/Redis/FFmpeg; workspace/test typecheck, lint and production build passed; both admin Chrome scenarios passed, including tariff publication and session support. External payment providers were not called.
Final pricing-only Chrome rerun passed after making its fixture name unique across repeated runs; desktop/mobile form screenshots were inspected without page overflow.
