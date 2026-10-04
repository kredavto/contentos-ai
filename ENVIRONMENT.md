# Environment

Configuration is parsed server-side with Zod. Public fields are only product name, app URL and safe capability metadata. Product name defaults to CONTENTOS AI and is overridable from one configuration source.

Required runtime groups: APP_URL/NODE_ENV; DATABASE_URL; REDIS_URL; ENCRYPTION_KEYS/ACTIVE_ENCRYPTION_KEY; S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY; email configuration; enabled provider credentials. Exact implemented keys live in .env.example as slices are added.

Production must reject mock mode, missing encryption keys, insecure origins and unconfigured required dependencies. Optional adapters remain CONFIGURATION_REQUIRED. Local secrets live in ignored .env files. Never expose provider variables using NEXT_PUBLIC prefixes. Rotate keys by adding a new version, re-encrypting records, then removing the retired key only after verification.

Implemented identity slice: SMTP_URL (smtp/smtps connection URI), EMAIL_FROM. Use Mailpit at localhost:1025 locally. Production forces STARTTLS/implicit TLS. The web service uses APP_URL as its CSRF allowed origin; configure preview deployments with their exact origin. Local/self-hosted clients share a conservative IP rate-limit bucket until a trusted edge header is configured; Vercel uses its overwritten x-vercel-forwarded-for header.

`pnpm dev` and `pnpm db:migrate` load the ignored root .env through Node's native environment loader. TEST_DATABASE_URL must point to a dedicated database whose name ends in `_test`. Browser tests use a loopback SMTP sink on 1026/8026 and never send real email. PLAYWRIGHT_CHANNEL=chrome optionally uses an installed Google Chrome; otherwise install Playwright Chromium.

## Generation worker

Set `AI_PROVIDER=openai`, `OPENAI_API_KEY` and `OPENAI_MODEL` on both web and worker for real generation. Model selection is explicit; no model or API key is silently provisioned. Missing configuration returns `CONFIGURATION_REQUIRED`. Use `AI_PROVIDER=mock` only for local/CI fixture generation; production validation rejects it. The UI identifies mock output visibly. `WORKER_HEALTH_PORT` optionally serves loopback `/health`; expose via an internal proxy only. Web and worker must use the same PostgreSQL, Redis and AI configuration.

Local: copy `.env.example` to `.env`, choose `AI_PROVIDER=mock` for a no-cost walkthrough, run `pnpm db:migrate`, then `pnpm dev` to run web and worker. Request starter credits once from the content studio after verifying email. Credit prices come from `usage_policies`, not UI constants. The starter grant is one per verified owner account across organizations.
