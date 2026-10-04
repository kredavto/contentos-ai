# Provider contract and integration policy

Contracts: LLMProvider, ImageProvider, AvatarProvider, VoiceProvider, VideoProvider, CaptionProvider, TrendProvider, PublishingProvider, AnalyticsProvider, PaymentProvider, StorageProvider; additionally EmailProvider and ErrorReporter.

All return validated normalized results and provider/external_id/internal_id/metadata mappings. Calls carry correlation ID, operation idempotency key and abort signal. Adapters own endpoint/API versions, credential access, official schemas, timeouts, retries and safe request metrics. UI only sees internal IDs and safe capability/status descriptions.

First avatar adapter: HeyGen. First payments adapter: YooKassa; Stripe-ready contract. LLM/image/captions may use OpenAI behind contracts. Publishing targets YouTube, TikTok, Instagram, VK and Telegram via official APIs; implement enabled capabilities honestly and report unsupported capabilities. OAuth includes state, PKCE where applicable, encrypted tokens, refresh and revocation.

Before implementing an adapter, review current official documentation and record exact sources/date in docs/provider-research.md. Do not infer endpoints, signatures, scopes or payload fields. Credentials/approval absent → CONFIGURATION_REQUIRED. Explicit local mock mode is prohibited in production and must be visible in UI. CI uses contract fixtures and mocks; no live paid API calls.

## OpenAI text generation

`OpenAILLMProvider` uses the official OpenAI SDK Responses API with strict JSON Schema text format, `store:false`, bounded output tokens, AbortSignal and no SDK automatic retries. `GenerationOrchestrator` validates with Zod, records usage before schema repair, and only uses explicitly supplied model/provider routes. Refer to https://developers.openai.com/api/docs/guides/structured-outputs. Contract tests intercept SDK fetch; no live paid request was made and no key was created. Model and credentials remain deployment configuration. Strategies, ideas and scripts have deterministic workflows; the other requested AI modules remain outstanding.

## HeyGen v3

Real photo avatar, public avatar/voice discovery, avatar status/deletion and direct video submission/status adapters are implemented with contract tests. Avatar and video adapters are wired to consent-gated durable jobs, with public voice selection and private render ingestion. The server adapter has not yet been exercised with live credentials. See [API evidence and remaining integration work](docs/heygen-integration.md).

## Private S3 photos

The real AWS SDK S3 adapter now backs the brand photo library with bounded uploads, signed GET URLs and persistent deletion retries. Core services decode and sanitize photos before storage. Loopback transport tests cover the UI and worker; no production bucket is connected. See [media workflow and configuration](docs/media-storage.md).

## Caption transcription

`CaptionProvider` accepts worker-extracted mono PCM WAV (16 kHz, <=6 MB) and returns Zod-validated ordered, non-overlapping segments. The OpenAI adapter uses `POST /v1/audio/transcriptions`, `whisper-1`, `verbose_json` and segment timestamp granularity. Source: https://developers.openai.com/api/docs/guides/speech-to-text (checked 2026-10-04). The server-only `OPENAI_API_KEY` is reused. No live transcription was made during implementation.

The provider SDK has retries disabled. A durable STARTED checkpoint precedes submission. An uncertain response or worker interruption enters RECONCILIATION, never automatic paid replay. The user can explicitly continue with manual captions; the caption credit reservation is released and the stored source is reused. A successful response is stored before telemetry and enters WAITING_REVIEW. Users edit timed segments and choose clean/bold style, then explicitly confirm the current revision. Only that snapshot is burned into the final render. AI_CREDITS for AUTO_CAPTIONS are configured in usage_policies (initial value 3), reserved upfront, captured with successful final video completion and released on terminal failure/cancellation. Source video downloads are private signed URLs lasting 120 seconds.

`CAPTION_PROVIDER=mock` is development/test only; production missing configuration reports CONFIGURATION_REQUIRED. The mock returns a short fixture transcript and is used with real FFmpeg in E2E. Manual subtitles do not require OpenAI.


## Telegram connection inspection

`SocialConnectionProvider` has a real Telegram implementation using getMe, getChat and getChatMember. Only channels with administrator posting rights become ACTIVE. Requests and responses are bounded and validated; errors and structured logs omit tokens and full request URLs. Server-side encrypted credentials support replacement, disconnect and key rotation. No messages are sent by this adapter. Production requires SOCIAL_PROVIDER=telegram and a valid encryption keyring; other platform OAuth and publishing adapters remain pending. See [connection documentation](docs/social-connections.md) and [official API research](docs/publishing-next.md).
