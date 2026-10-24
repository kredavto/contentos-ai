# Versioned application API

The application API uses `/api/v1`. Browser JSON requests, photo uploads and chunked library uploads use this prefix. The existing `/api/...` application routes remain compatible during migration; both forms enter the same route dispatcher, session, Origin, throttling and domain authorization checks. There is no alternate service or repository path for legacy requests.

Successful application JSON responses use `{data, meta: {requestId}, error: null}`. Missing action data is represented as null. Errors use `{data: null, meta: {requestId}, error: {code, message, requestId, correlationId}}`; correlationId remains as an additive compatibility alias. Both identifiers match X-Request-Id and structured server logs. Responses retain no-store, safe public error messages and Retry-After on rate limiting.

The specification's authentication paths are available under `/api/v1/auth`: register, login, logout, forgot-password, reset-password, verify-email and GET session. The canonical browser URLs for the previous `auth/verify` and `me` calls are verify-email and auth/session. Old paths remain usable; unknown numeric API versions are rejected, not silently mapped to v1.

Registered external routes retain their contracts: `/api/webhooks/yookassa` acknowledges durable receipt using the provider-compatible response; `/api/social/youtube/callback` retains its redirect and referrer policy; `/api/health` retains its health contract. The response wrapper does not rewrite binary bodies or redirects. Provider callback registration is not changed by this migration.

This closes the version-prefix/envelope gap, not every domain endpoint listed in specification §§110–124. Missing CRUD operations and domain workflows must be tracked separately. A unit route fixture is not proof of production authorization: the full browser chain and existing tenant/domain suites remain required before acceptance.

## Checks

Focused route tests cover canonical and legacy session/verification paths, all required auth command dispatch, Origin refusal before actions, secure login cookies, unknown versions, correlated errors and rate-limit headers. Error-wrapper tests preserve binary and redirect responses. Existing webhook receipt tests guard its unchanged acknowledgement. Browser scenarios are migrated to the versioned application paths, including network interceptions and uploads. Full local acceptance passed: types, lint, production build, 661 tests and all 32 Chrome scenarios. Production infrastructure and real provider acceptance remain separate.
