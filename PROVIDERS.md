# Provider contract and integration policy

Contracts: LLMProvider, ImageProvider, AvatarProvider, VoiceProvider, VideoProvider, CaptionProvider, TrendProvider, PublishingProvider, AnalyticsProvider, PaymentProvider, StorageProvider; additionally EmailProvider and ErrorReporter.

All return validated normalized results and provider/external_id/internal_id/metadata mappings. Calls carry correlation ID, operation idempotency key and abort signal. Adapters own endpoint/API versions, credential access, official schemas, timeouts, retries and safe request metrics. UI only sees internal IDs and safe capability/status descriptions.

First avatar adapter: HeyGen. First payments adapter: YooKassa; Stripe-ready contract. LLM/image/captions may use OpenAI behind contracts. Publishing targets YouTube, TikTok, Instagram, VK and Telegram via official APIs; implement enabled capabilities honestly and report unsupported capabilities. OAuth includes state, PKCE where applicable, encrypted tokens, refresh and revocation.

Before implementing an adapter, review current official documentation and record exact sources/date in docs/provider-research.md. Do not infer endpoints, signatures, scopes or payload fields. Credentials/approval absent → CONFIGURATION_REQUIRED. Explicit local mock mode is prohibited in production and must be visible in UI. CI uses contract fixtures and mocks; no live paid API calls.

## OpenAI text generation

`OpenAILLMProvider` uses the official OpenAI SDK Responses API with strict JSON Schema text format, `store:false`, bounded output tokens, AbortSignal and no SDK automatic retries. `GenerationOrchestrator` validates with Zod, records usage before schema repair, and only uses explicitly supplied model/provider routes. Refer to https://developers.openai.com/api/docs/guides/structured-outputs. Contract tests intercept SDK fetch; no live paid request was made and no key was created. Model and credentials remain deployment configuration. Strategies, ideas and scripts have deterministic workflows; the other requested AI modules remain outstanding.

## HeyGen v3

Real photo avatar, public avatar/voice discovery, avatar status/deletion and direct video submission/status adapters are implemented with contract tests. They are not yet wired to a consent-gated media job flow or used with live credentials. See [API evidence and remaining integration work](docs/heygen-integration.md).
