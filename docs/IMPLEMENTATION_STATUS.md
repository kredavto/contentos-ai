# Implementation status

Updated 2026-10-04. This is an implementation inventory, not a claim that the full specification is complete.

## Verified working slice

- pnpm 10.30.3 / Turborepo monorepo: apps/web, apps/worker and seven requested packages; strict TypeScript 5.9.3, ESLint 10, Vitest, Playwright.
- Next.js 16.3.8 Russian-first responsive UI with Tailwind 4, shared shadcn-style Radix/CVA button and original green/ivory visual design.
- Email/password registration, real SMTP adapter, email verification, reset links, login/logout and revoke-all-sessions API. scrypt N=131072/r=8/p=1; random tokens hashed at rest; HttpOnly/SameSite/Secure-in-production cookies.
- Atomic shared PostgreSQL rate limits, exact-Origin mutation checks, bounded JSON bodies, safe normalized API errors and correlation IDs.
- Persisted organizations/members/workspaces/brands. Role guards and tenant-scoped repository transactions; composite tenant foreign keys and database role/state constraints.
- Resumable 15-step onboarding, optimistic revisions, normalized Brand Brain rows, explicit completion and read-only completed summary. Existing completed Brand Brain editor is still to be added.
- Database schema: 57 tables with twenty-one SQL migrations (0000–0020). Initial migration's index-before-FK ordering was repaired before its first successful application; subsequent migrations are additive.
- Typed provider contracts for all requested provider categories; SMTP and OpenAI Responses adapters are implemented; OpenAI has contract tests but no live paid call.
- Local PostgreSQL 17, Redis 7 and Mailpit Compose stack is running. Separate PostgreSQL 16 container was used for initial integration/E2E development.
- CI workflow runs migrations, all typechecks, lint, unit/integration tests, production build and Playwright E2E. Remote CI passed all stages, including database and browser tests, for commit 97f41ba (run 37195435512).

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

## Verification evidence

- Typecheck for all 9 workspace packages and test sources passed.
- ESLint passed.
- 69 tests in 14 Vitest files passed against real PostgreSQL 17. Coverage: role policy, foreign-key tenant isolation, concurrent token consumption, sessions/password reset, stale login prevention, atomic rate limits, normalized onboarding and revision conflicts, consent evidence/revocation, HeyGen/S3 contracts, safe photo decoding, upload idempotency, tenant/brand media access, avatar reservation/capture/release, consent-bound jobs, expired replay windows, late references, normal polling and durable deletion/fencing.
- 2 Playwright tests passed in installed Chrome: register → SMTP email → verify → login → organization → brand → 15 onboarding steps → save/reload/resume → Brand Brain → starter credits → strategy/30-day plan → ideas → script → manual edit/version history → approval → mobile logout, consent acceptance → revocation → reload persistence, photo upload → signed preview → consent grant → avatar job → ready → credit capture → public voice selection/reopen persistence → worker group deletion → photo deletion, plus CSRF/anonymous request rejection. HttpOnly/SameSite cookie assertions and no browser page errors.
- Agent-browser verified homepage renders, navigation exists and no Next error overlay/browser errors. Desktop/mobile dashboard, media-library and avatar screenshots visually inspected; mobile overflow check passed.
- Production Next.js build passed for implemented routes.
- Browser tests caught and fixed Strict Mode token clearing and textarea label association after reload.

## Full objective still outstanding

- Durable mail delivery and cleanup, OAuth authentication extensibility/flows, team invitations/role management and agency clients.
- Extend the implemented text/avatar/video/publishing job engine to additional platforms and webhooks, including operator reconciliation and provider pricing configuration.
- Remaining image/media, YooKassa, YouTube/TikTok/Meta/VK and platform analytics adapters; production configuration and live verification of HeyGen/S3/Telegram remain pending.
- Remaining AI workflows beyond strategy/ideas/scripts; downstream publishing transitions from the implemented editorial calendar.
- Private voice cloning/import, cover studio, B-roll and general video/audio media library; operator investigation of expired unknown submissions.
- OAuth flows and refresh for additional social platforms, autopilot, verified/idempotent webhooks, additional delivery-status adapters and normalized/raw analytics.
- AI recommendations with acceptance, comments/reply safety modes, funnels/UTMs, subscription billing/plans/renewal and financial dashboards.
- Admin/support/audit UI, notifications, privacy export/deletion workflows, broader media access flows, feature flags, Sentry-compatible implementation, readiness/provider monitoring.
- Complete development seed, full requested E2E beyond onboarding, remaining adapter/webhook/media/publishing tests, platform-wide security and architecture review.
- Production Docker images/release flow, GLOBAL/RU deployment configuration and infrastructure, backups/restore verification, production credentials.
- Vercel deployment and verification. No deployment has happened; scaffold/partial functionality is not represented as the finished product.

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
