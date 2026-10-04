# Performance analysis: validated engine and integration contract

The AI package now exposes `GenerationOrchestrator.analyzePerformance(evidence, strategy, context, recorder)`. It uses the configured LLM route and existing provider adapter, timeout, bounded repair, explicit fallback and per-call usage recording. This is an engine-level implementation. There is **no user-facing analysis endpoint or queued OPTIMIZE_STRATEGY job yet**, and no recommendation is applied to a strategy or Brand Brain.

## Evidence and output boundaries

The strict evidence schema accepts at most 50 distinct published items and one observation per item, with an explicit collection window, snapshot time, total count and truncation indicator. The repository integration must select observations deterministically, inside the authorized enqueue transaction; the client must never supply its own evidence. Observations retain provider, provenance, observation ID/time and nullable normalized metrics. At least one measured observation is required. Published content attributes are whitelisted; provider credentials, private storage keys and media references are not accepted.

Reports contain exactly seven dimensions: topics, hooks, formats, duration, CTAs, audience and outliers. A descriptive comparison requires at least two distinct observations (five for outliers), the same provider and provenance class, and a non-null selected metric for every cited item. Zero remains a real measurement. The elapsed time from publication to observation may differ by at most the larger of one hour and 20% of the minimum age. This is a comparability guard, not a significance test. Hook, CTA and duration comparisons require known corresponding attributes. Measured audience breakdowns are not available, so audience comparisons are rejected.

All citations must be observation IDs in the frozen evidence. Context validation runs after structured JSON validation, including during repair. Consumers of cached results must call the same validator again. Constraints do not prove the truth of arbitrary natural language: the prompt and eventual UI must identify descriptive associations, limited samples, manual/demo provenance and missing evidence, and must not present causal or statistically significant conclusions.

Recommendations contain a bounded experiment, measurable success rule, horizon and a typed replacement for one of frequency, toneOfVoice, formats, CTAs or hypotheses. They cannot express an arbitrary JSON patch or a permanent Brand Brain edit. The explicit development fixture produces a labeled DEMO report and is unavailable in production.

## Remaining integration

- Add the feature flag, database pricing policy and durable OPTIMIZE_STRATEGY job, reserving before execution and capturing only on validated persisted success.
- Snapshot authorized publication observations, exact current strategy version and Brand Brain revision before the paid operation. Reuse that immutable input on retries; do not reconstruct changing evidence on the worker.
- Persist tenant-scoped append-only reports, recommendations and accept/reject decisions, with composite foreign keys and immutable evidence.
- Provide manager-only, idempotent decision actions. Acceptance must create a new strategy version with version/revision conflict checks; rejection must not change strategy. Neither operation may mutate Brand Brain.
- Add the report, source/coverage details, progress/credit price and concrete recommendation preview to Analytics. Require explicit acceptance in that interface.
- Verify transaction races, tenant isolation, ledger settlement, cached-output revalidation and the complete browser workflow before enabling the feature.

No live OpenAI request was made for this implementation. Missing production key/model configuration still fails with CONFIGURATION_REQUIRED.
