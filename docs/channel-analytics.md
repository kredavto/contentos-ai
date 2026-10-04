# Background channel analytics

Channel membership observations are separate from publication metrics. They measure the whole channel and never populate post reach, views or attributable `followers_delta`.

The real Telegram adapter calls the official [getChatMemberCount](https://core.telegram.org/bots/api#getchatmembercount) read method with the saved numeric channel mapping and decrypted credential. It validates a bounded response and a nonnegative integer result, preserves measured zero, redacts credential-bearing transport errors and records safe request timing/correlation metadata. The adapter makes one HTTP attempt; retries belong to the worker. Only the numeric result is retained as raw evidence, not arbitrary envelopes or credentials.

Enable `ANALYTICS_ENABLED=true` with `SOCIAL_PROVIDER=telegram` and the same credential keyring in web and worker. Missing configuration reports CONFIGURATION_REQUIRED. `SOCIAL_PROVIDER=mock` is restricted to development/test and produces explicitly marked DEMO observations (fixed fixture count 1000). It makes no network request. Live and demo provenance cannot be swapped after enqueueing.

## Durable workflow

A verified owner, administrator or manager requests collection through the Analytics tab. This is on-demand background collection, not a recurring polling subscription. One in-flight job per connection and a 60-second request cooldown bound usage. Each request has a tenant-scoped UUID idempotency key bound to its creator, brand and connection.

Migration 0017 adds `channel_analytics_jobs` (FETCH_ANALYTICS), immutable `channel_metrics` and separately stored immutable `channel_metric_evidence`. Job intent is immutable; delivery/state fields remain mutable. Tenant composite foreign keys guard connections, jobs and evidence. All transitions are audited.

The database due-job scan acts as the delivery outbox for BullMQ queue `contentos-analytics`. Queue IDs are stable, dispatch is replayable, leases last 60 seconds, the provider deadline is at most 20 seconds, and execution allows at most three attempts within 24 hours. Transient reads retry after 10 then 20 seconds. Expired leases may be reclaimed; old lease tokens cannot save results. Successful observations and raw evidence commit atomically with terminal success.

Authorization, connection state, provider identity and credential generation are checked before the request and before commit. Disconnecting or replacing credentials cancels queued/running analytics jobs. Late responses are discarded. Role withdrawal or missing configuration prevents an observation from being stored. The API can read membership for ACTIVE or LIMITED connections: posting permission is not required for a read, but the provider must still authorize the request. Provider failures do not erase earlier observations or fabricate new ones.

## UI and API

Under `/api/organizations/:tenant/brands/:brand`:

- GET `/channel-analytics`: up to 100 connection summaries, each with latest observation and latest job; no secrets, external mappings, raw evidence or lease tokens.
- POST `/channel-analytics`: `{connectionId,idempotencyKey}` creates a background request and returns HTTP 202.
- GET `/channel-analytics/:connection`: latest 100 observations after tenant/brand authorization, including historical observations after disconnect.

The UI polls safe local job state, labels saved observation time and API/DEMO source, shows errors instead of zeros, and disables unavailable/in-flight/recent requests. History computes changes only between successive observations from the same source with distinct timestamps. The exact comparison interval is displayed; the change is not attributed to a post. Manual publication observations remain a separate section.

No live Telegram call is performed by automated tests. Contract tests use fixture transport; integration tests use real PostgreSQL; the browser journey uses real Redis/BullMQ with the explicitly mocked external provider.

Still outstanding: recurring collection policy, other platform adapters, post-level automatic metrics when supported, full raw-evidence retention/redaction workflows, pagination/exports and AI Performance Analyst recommendations with explicit accept/reject.
