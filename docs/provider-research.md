# Provider / framework research

2026-10-04:
- SMTP adapter: https://nodemailer.com/smtp — connection URLs, TLS and transport timeouts. Real SMTP transport, local Mailpit / test SMTP sink. Production requires TLS; absent SMTP configuration reports CONFIGURATION_REQUIRED. Email is a short bounded request; durable retry delivery is still planned.
- Next.js cookies: https://nextjs.org/docs/app/api-reference/functions/cookies — asynchronous cookie store; mutation cookies set in route handlers.
- Next.js local installed documentation: apps/web/node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md and 15-route-handlers.md. Confirmed server/client boundaries, asynchronous route params, no default route-handler caching.
- Drizzle transactions: https://orm.drizzle.team/docs/transactions. Applied and tested PostgreSQL transactions, row locks, concurrent consumption and compound ownership foreign keys.

No OpenAI, HeyGen, social or payment adapter implemented yet. Their current official schemas must be verified before implementation.

- Nodemailer release review: https://github.com/nodemailer/nodemailer/releases — upgraded to 10.0.14, removed obsolete separate type declarations, verified SMTP via E2E and a clean production dependency audit.
