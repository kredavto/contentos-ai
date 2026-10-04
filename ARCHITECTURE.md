# Architecture

Status: accepted design; implementation coverage is tracked separately in docs/IMPLEMENTATION_STATUS.md.

CONTENTOS AI is a modular monolith with a separately deployable asynchronous worker. Next.js handles rendering, authentication and short typed API requests. PostgreSQL owns business state. Redis/BullMQ delivers jobs; it is not the source of truth. S3 holds original and derived assets separately. FFmpeg runs only in isolated worker processes with controlled input paths and resource limits.

## Boundaries
- apps/web: Russian-first UI, BFF routes, secure session cookies, normalized errors.
- apps/worker: transactional job claims, outbox dispatch, provider polling, media processing, scheduled publication and analytics.
- packages/types: Zod schemas, domain states, provider contracts.
- packages/config: validated server environment and public product configuration.
- packages/db: Drizzle tables, SQL migrations and tenant-scoped persistence.
- packages/core: authorization, onboarding, content lifecycle, ledger, approvals, privacy.
- packages/ai: deterministic workflows, prompt construction, schema validation/repair, usage accounting.
- packages/providers: official API integrations, encryption, request timeouts and safe observability.
- packages/ui: accessible reusable UI primitives.

## Major workflows
Registration → email verification → organization/workspace → brand → resumable 15-step onboarding → structured Brand Brain. Authenticated context resolves organization membership on every access; client tenant IDs alone never authorize access.

Strategy/ideas/script requests validate and authorize, reserve credits, append a DB job and outbox record in one transaction, and return 202. Worker constructs prompts from tenant-owned structured data, validates provider JSON, records versions/usage and completes the job. Terminal failure releases reservations. Queue redelivery cannot repeat committed effects.

Approved script + valid subject consent + avatar → video project → provider rendering → isolated FFmpeg normalization/captions/B-roll/cover → QC → ready. Original/final renders use separate keys. Every transition is persisted and correlated.

Human content approval → UTC schedule + social connection → idempotent publishing job → provider receipt/status → normalized metrics → recommendations awaiting explicit acceptance. Automatic publishing and replies are disabled by default.

Payment creation uses stable idempotency keys. Authenticated provider confirmation, amount/currency/subscription checks and deduplicated events precede ledger grants. A return URL never proves payment success.

## Failure model
At-least-once delivery; exactly-once local effects via unique constraints and transactions. Remote timeouts can be ambiguous: reconcile against external job/payment/publication identifiers instead of charging or publishing twice. Disabled or unconfigured adapters return a typed error, never demo output. Mock providers require explicit non-production mode.

## Deployment
See DEPLOYMENT.md. GitHub repository: https://github.com/kredavto/contentos-ai. Docker web and worker images share one version. Migrations run as a single release job. Health checks separate liveness and dependency readiness. Backups, restore drills, key rotation and rollback are release requirements.
