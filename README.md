# CONTENTOS AI

AI content operations SaaS. Implemented: email/password accounts, verified email, password reset, revocable sessions, organizations, brands and a persisted 15-step Brand Brain onboarding. Strategy/ideas/script and standalone post generation, content approval/version history, durable BullMQ jobs and immutable credit accounting are also implemented. Avatar/voice selection and basic video generation, FFmpeg processing, [versioned Cover Studio](docs/video-covers.md), storage and approval are implemented. Approval-based Telegram publishing, analytics/recommendations, monthly billing and in-app notifications are implemented. Additional providers and richer editing remain in development. See [coverage and gaps](docs/IMPLEMENTATION_STATUS.md).

**Release status: IN DEVELOPMENT · live server integrations: UNVERIFIED · production acceptance: NOT ESTABLISHED.** Implemented workflows and automated fixture tests do not prove live provider delivery, full specification completion or commercial readiness. A successful web deployment or preview build alone does not establish a working production backend.

Source: [kredavto/contentos-ai](https://github.com/kredavto/contentos-ai). Web deployment target: Vercel team digagency. Persistent BullMQ/FFmpeg work requires a separate compatible worker service, PostgreSQL, Redis and private S3 storage. Runtime credentials, dependency readiness, backup/restore and live end-to-end verification are separate launch gates; this documentation does not attest that those gates have passed.

## Development stages

Scope labels distinguish implemented application paths from full product completion, live-provider verification and production acceptance. **IMPLEMENTED** means the named code path is connected, not that every related requirement is complete; **PARTIAL** means important scope remains; **LIVE UNVERIFIED** and unestablished production acceptance remain separate even when CI is green. These labels are not completion percentages.

Use the [implementation inventory and dated evidence](docs/IMPLEMENTATION_STATUS.md) and [completion checklist](docs/COMPLETION_CHECKLIST.md) for current functional scope. The [readiness review](docs/READINESS.md) preserves the historical `f7b069b` baseline and its verification/launch criteria. Its earlier stage register and feature-pending list are **not** the current inventory: later work includes billing/subscriptions, Cover Studio, broader editing, team/privacy operations and additional publishing workflows. Do not regress these implemented slices to pending solely because they were absent from that older baseline.

The full MVP is **not established as complete**. The section 170 acceptance chain in [TECH_SPEC.md](TECH_SPEC.md) must work with live services; mocked browser checks do not close that gate. Supported platforms, unfinished scope, live integrations, operating infrastructure and production acceptance must each be verified explicitly before commercial launch.

## Local development

Requires Node.js 22.12+ (24 recommended and used in CI), pnpm 10.30.3 and Docker.

```sh
cp .env.example .env
node scripts/configure-local-key.mjs
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

The local setup command generates a private encryption key in ignored `.env` without printing or replacing it. Keep the key backed up: pending email links and connected-provider credentials depend on it.

Open http://localhost:3100. Register with a fictional address and read its confirmation email in [local Mailpit](http://localhost:8025). Passwords require 12–128 characters. After confirmation, sign in, create an organization/brand and complete onboarding. Each step can be saved and resumed. Brand Brain is stored as structured PostgreSQL rows. Set `AI_PROVIDER=mock` in your local `.env` for an explicitly marked demo walkthrough, then restart `pnpm dev`. Open the completed brand, claim starter credits, create a strategy, ideas and a script, edit it and approve a version. Web and the actual worker run together. For real text generation, configure `AI_PROVIDER=openai`, `OPENAI_API_KEY` and `OPENAI_MODEL` server-side on both services; no live provider test has been performed.

Optional: populate a fictional brand, strategy, ideas and script with `pnpm db:seed`. See [local demo setup and safeguards](docs/development-seed.md) for the required opt-in and private password.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

For a disposable environment with PostgreSQL, Redis and FFmpeg, run `pnpm test:local`. Add `--e2e tests/e2e/onboarding.spec.ts` for the production-build browser MVP. Add `--recovery` before `--e2e` to rehearse PostgreSQL backup/restore with data and integrity checks. See [local verification](docs/local-verification.md) for prerequisites and cleanup behavior and [recovery scope](docs/database-recovery.md).

For database integration and browser tests, use a dedicated PostgreSQL database ending in `_test`. Never point tests at real customer data. Create it in local Docker, then:

```sh
docker compose exec postgres createdb -U contentos contentos_test
export TEST_DATABASE_URL=postgresql://contentos:local-development-only@localhost:5432/contentos_test
DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
```

The integration suite runs when TEST_DATABASE_URL is present; otherwise it is explicitly skipped. Playwright requires it and starts a loopback SMTP sink (1026/8026), an S3 transport fixture (8027), and the web server on port 3187. Stop any existing development server before running E2E. Use PLAYWRIGHT_CHANNEL=chrome for an installed Google Chrome. CI runs migrations, typecheck (including tests), lint, unit/integration tests, production build and E2E.

## Architecture

[Architecture](ARCHITECTURE.md) · [Data model](DATA_MODEL.md) · [Security](SECURITY.md) · [Providers](PROVIDERS.md) · [Deployment](DEPLOYMENT.md) · [Environment](ENVIRONMENT.md) · [Engineering rules](AGENTS.md).

## Private photo library

The brand content studio includes a Media tab for private photo uploads, short-lived previews and durable deletion. Configure the same private S3 bucket on web and worker using `.env.example`. Details and limits: [media storage](docs/media-storage.md). Without storage credentials the UI reports that configuration is required. Avatar/video jobs use the same storage and durable worker. See ENVIRONMENT.md for video configuration.

## Brand Guardian

Saved scripts can be reviewed asynchronously against their versioned brand context. Reports quote the source text, identify possible rule/tone issues and flag claims for human verification; they never auto-approve or rewrite content. See [review behavior and limits](docs/brand-guardian.md).

The [Post Writer](docs/posts.md) creates versioned plain-text posts and lets an approved post prefill a separately reviewed calendar draft.

The [Carousel Studio](docs/carousels.md) generates editable, versioned slides with approval and browser PNG export. Album publishing is not yet connected.

Optional [server error monitoring](docs/error-monitoring.md) sends only safe operational metadata and is disabled until configured.

The [Image Studio](docs/image-generation.md) queues metered image generation, stores private normalized JPEGs and supports review, approval and durable deletion. OpenAI/S3 configuration is required for real output; local fixtures are clearly marked as demo.

Optional video watermark settings and behavior: [video watermarks](docs/video-watermarks.md).
