# Performance analysis and reviewed strategy recommendations

The AI package now exposes `GenerationOrchestrator.analyzePerformance(evidence, strategy, context, recorder)`. It uses the configured LLM route and existing provider adapter, timeout, bounded repair, explicit fallback and per-call usage recording. The OPTIMIZE_STRATEGY workflow runs in the persistent generation worker. Its input is frozen at authorized enqueue, reports are persisted atomically with credit capture, and managers can explicitly accept or reject recommendations from Analytics. Acceptance creates a strategy version; permanent Brand Brain is never edited.

## Evidence and output boundaries

The strict evidence schema accepts at most 50 distinct published items and one observation per item, with an explicit collection window, snapshot time, total count and truncation indicator. The repository selects the latest observation deterministically inside the authorized enqueue transaction. The client supplies a 7/30/90-day window, never evidence. Observations retain provider, provenance, observation ID/time and nullable normalized metrics. At least one measured observation is required. Published content attributes are whitelisted; provider credentials, private storage keys and media references are not accepted.

Reports contain exactly seven dimensions: topics, hooks, formats, duration, CTAs, audience and outliers. A descriptive comparison requires at least two distinct observations (five for outliers), the same provider and provenance class, and a non-null selected metric for every cited item. Zero remains a real measurement. The elapsed time from publication to observation may differ by at most the larger of one hour and 20% of the minimum age. This is a comparability guard, not a significance test. Hook, CTA and duration comparisons require known corresponding attributes. Measured audience breakdowns are not available, so audience comparisons are rejected.

All citations must be observation IDs in the frozen evidence. Context validation runs after structured JSON validation, including during repair. Consumers of cached results must call the same validator again. Constraints do not prove the truth of arbitrary natural language: the prompt and eventual UI must identify descriptive associations, limited samples, manual/demo provenance and missing evidence, and must not present causal or statistically significant conclusions.

Recommendations contain a bounded experiment, measurable success rule, horizon and a typed replacement for one of frequency, toneOfVoice, formats, CTAs or hypotheses. They cannot express an arbitrary JSON patch or a permanent Brand Brain edit. The explicit development fixture produces a labeled DEMO report and is unavailable in production.

## Durable execution and decisions

Set `ANALYTICS_AI_ENABLED=true` on both web and worker and configure the existing AI provider/key/model. The flag defaults to false and is checked at both boundaries. The database usage policy owns the operation price (initially five AI credits), and the UI reads it from that policy. Missing strategy/observations fail before reservation. Existing outbox, bounded retries, leases, heartbeat and per-call usage recording apply. A cached response is context-validated against the same frozen input before reuse. Permanent failures release the reservation. Reports and recommendations are inserted in the same transaction as capture and job completion.

Migrations 0018–0020 add reports, recommendations and immutable decisions, extend strategy versions with an optional human author, and protect performance job input from mutation. Reports reference the analyzed strategy version through a composite tenant foreign key. Evidence and decisions are append-only. Reads are tenant/brand scoped; mutations require a verified owner/admin/manager.

`GET .../brands/:brandId/performance` returns the latest twenty reports with evidence and decisions. `POST` accepts a recommendation ID, ACCEPTED/REJECTED, the reviewed current strategy version and an idempotency UUID. Exact replays return the saved decision. Acceptance locks the tenant and Brand Brain revision, checks the expected version, validates the full resulting strategy and appends a version. A newer independently generated strategy invalidates old recommendations. Disjoint accepted fields from the same report can be applied sequentially; intervening edits to the target field conflict. Rejection does not create a version and remains possible for stale reports. Both decisions are audited.

Analytics displays collection dates, coverage, all seven dimensions, source observations, nullable metrics and each experiment's measurement rule. The current and proposed field values are shown before an explicit acceptance checkbox. No client-supplied arbitrary patch is accepted. User-facing history survives reload. The local fixture and any reports generated from it are explicitly DEMO.

## Remaining scope

Automatic publication-level platform analytics, measured audience breakdowns and recurring collection are not implemented. Current publication observations are entered manually; whole-channel membership counts are a separate workflow and are not attributed to posts. Live provider verification, additional AI workflows and the full SaaS/deployment scope remain outstanding. The schema does not attempt to prove arbitrary natural-language claims; reports need human review.

No live OpenAI request was made for this implementation. Missing production key/model configuration still fails with CONFIGURATION_REQUIRED.
