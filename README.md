# CONTENTOS AI

AI content operations SaaS. Implemented: email/password accounts, verified email, password reset, revocable sessions, organizations, brands and a persisted 15-step Brand Brain onboarding. Strategy/ideas/script generation, script approval/version history, durable BullMQ jobs and immutable credit accounting are also implemented. Avatar/voice selection and basic video generation, FFmpeg processing, storage and approval are implemented. Approval-based Telegram publishing, analytics/recommendations, monthly billing and in-app notifications are implemented. Additional providers and richer editing remain in development. See [coverage and gaps](docs/IMPLEMENTATION_STATUS.md).

Source: [kredavto/contentos-ai](https://github.com/kredavto/contentos-ai). Web deployment target: Vercel team digagency. Long-running media/queue work requires a separate worker service. No production deployment yet. [Staging web preview](https://contentos-54l7vlhlu-digagency.vercel.app) is available; account operations require the still-unconfigured production data/worker services.

## Local development

Requires Node.js 22+ (24 used in CI), pnpm 10.30.3 and Docker.

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

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

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
