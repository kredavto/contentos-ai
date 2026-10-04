# Provider contract and integration policy

Contracts: LLMProvider, ImageProvider, AvatarProvider, VoiceProvider, VideoProvider, CaptionProvider, TrendProvider, PublishingProvider, AnalyticsProvider, PaymentProvider, StorageProvider; additionally EmailProvider and ErrorReporter.

All return validated normalized results and provider/external_id/internal_id/metadata mappings. Calls carry correlation ID, operation idempotency key and abort signal. Adapters own endpoint/API versions, credential access, official schemas, timeouts, retries and safe request metrics. UI only sees internal IDs and safe capability/status descriptions.

First avatar adapter: HeyGen. First payments adapter: YooKassa; Stripe-ready contract. LLM/image/captions may use OpenAI behind contracts. Publishing targets YouTube, TikTok, Instagram, VK and Telegram via official APIs; implement enabled capabilities honestly and report unsupported capabilities. OAuth includes state, PKCE where applicable, encrypted tokens, refresh and revocation.

Before implementing an adapter, review current official documentation and record exact sources/date in docs/provider-research.md. Do not infer endpoints, signatures, scopes or payload fields. Credentials/approval absent → CONFIGURATION_REQUIRED. Explicit local mock mode is prohibited in production and must be visible in UI. CI uses contract fixtures and mocks; no live paid API calls.
