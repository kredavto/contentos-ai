# Error monitoring

The provider-independent ErrorReporter interface has an optional bounded flush. The Sentry adapter uses an isolated official @sentry/node 11 client: it does not initialize the global SDK or install automatic integrations. Existing structured operational logs remain available when reporting is disabled.

Set ERROR_REPORTING_PROVIDER=sentry, an HTTPS SENTRY_DSN from the selected Sentry-compatible service and an optional SENTRY_RELEASE (for example the commit SHA) in server-only runtime secrets for web and worker. No NEXT_PUBLIC variable is used. Invalid or missing configuration disables outbound reporting and is shown as CONFIGURATION_REQUIRED in the protected operator provider list. CONFIGURED means syntactically configured, not a successful live delivery. No account or paid monitoring service is provisioned by this code.

Reports contain an allowlisted error code, validated correlation/job UUIDs, fixed service/environment, optional release, event ID and timestamp. Original exception messages, stacks, source context, request URLs/headers/cookies/bodies, user/tenant data, database parameters, AI prompts and provider responses are deliberately excluded. SDK data collection and automatic integrations are disabled and beforeSend rebuilds the outbound event from permitted fields. This limits stack-level diagnostics: use correlation IDs to investigate safe local logs and durable task records.

Coverage: normalized API 5xx responses, Next Node server rendering/request errors, generation/avatar/video/cover/publishing/analytics/payment/webhook/email processor failures, queue errors, escaped BullMQ failures, dispatch, cleanup, notification and mail loop errors. Domain settlement/retry logic does not depend on reporting success. Private media deletion providers that internally retain a retry without throwing continue to be observable through durable state; browser-only exceptions and fatal process crashes are not automatically captured.

Each process sends at most 20 events per minute and buffers at most 20 pending events. Additional events are dropped; reporting is best-effort, not a durable audit trail. The official transport handles receiver rate limits. Web error responses await a flush up to one second; worker shutdown flushes up to two seconds. Transport/reporting failures must not change the domain result.

Verification uses the actual SDK envelope pipeline with a fixture transport, including sensitive exception content, malformed identifiers, burst limits and rejected transport. An encrypted-email integration test supplies a throwing reporter and verifies the durable retry still proceeds. No live telemetry is sent without runtime configuration.

Official references checked October 12, 2026:
- [Sentry isolated clients](https://docs.sentry.io/platforms/javascript/best-practices/shared-environments/)
- [Sentry Node options](https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/)
- [Next instrumentation and onRequestError](https://nextjs.org/docs/pages/api-reference/file-conventions/instrumentation)
Installed SDK declarations are authoritative for the v11 dataCollection options.

Browser fixtures force ERROR_REPORTING_PROVIDER=disabled. PLAYWRIGHT_WEB_MODE=production runs the built Next server with the existing isolated test environment; run pnpm build first. This avoids dev compilation during the browser scenario and preserves request/action timeouts. The SDK has a dedicated provider subpath and is a Next serverExternalPackage, so unrelated provider imports do not load it.
