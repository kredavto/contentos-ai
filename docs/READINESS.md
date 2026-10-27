# Development readiness

Reviewed: 2026-10-27. Implementation baseline: `f7b069b` on `main` (2026-10-04). This document distinguishes implemented code, automated verification with external fixtures, live service verification and production acceptance.

## Labels and promotion rules

- **IMPLEMENTED**: the named slice has a connected backend/UI/worker path and recorded automated evidence. It does not mean every related feature in TECH_SPEC.md is complete.
- **PARTIAL**: connected functionality exists, but the stage has open requirements listed in the README table.
- **PENDING**: the required connected workflow is not yet implemented; contracts or database tables alone do not qualify.
- **LIVE UNVERIFIED**: the application adapter has not completed a recorded run with real provider credentials. Plugin-only tests do not verify server adapters.
- **NOT DEPLOYED**: no accepted production web/worker release exists.

The [README stage table](../README.md#development-stages) is the stage register. Historical implementation and test records are in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md). Do not derive a percentage by counting rows: their scope and effort differ, and passing a mocked test does not close a live launch gate. The earlier conversational estimate of 60–70% is not a measured repository metric.

To promote a stage, finish its listed scope, run the relevant typecheck/lint/unit/integration/browser checks, record the commit and result, and update the stage register. Preserve explicit live and deployment labels until those separate gates pass.

## Latest implementation evidence (historical)

The latest feature is durable performance reports and reviewed strategy recommendations, merged as `8c13c2a` and documented by `f7b069b`. It includes frozen evidence, immutable reports/decisions, atomic credit capture, explicit acceptance/rejection, strategy version conflict checks and persisted UI history. See [performance boundaries](performance-analysis.md).

[CI run 37216727705](https://github.com/kredavto/contentos-ai/actions/runs/37216727705) passed for feature head `00700b4`: typecheck, lint, 162 tests, build and both Playwright scenarios. These are historical results, not a fresh 2026-10-27 run. The test providers were fixtures; live OpenAI/HeyGen/S3/Telegram validation remains outstanding.

## Verification on 2026-10-27

Source baseline: `f7b069b`; documentation-only changes do not alter application behavior.

- Frozen-lockfile install completed with project-pinned pnpm 10.30.3 and Node 24.22.1.
- Local `pnpm test`: **80 passed, 82 skipped** across 30 files (18 passed, 12 skipped). PostgreSQL integration suites explicitly skipped because TEST_DATABASE_URL was absent. This is not a full-suite pass.
- Fresh typecheck, lint, build and complete CI results are pending at this point; do not reuse historical green results as new evidence.
- No live paid AI call, live social publication or production deployment is part of this documentation verification.

## Launch gates

- [ ] Real server-adapter run: text generation, consent-bound avatar/video, private storage, reviewed captions and approved publication.
- [ ] Live statistics → performance report → explicit reviewed strategy decision, with honest manual/provider provenance.
- [ ] Resolve missing scope against TECH_SPEC.md sections 4, 5 and 170; declare supported platforms and unsupported capabilities explicitly.
- [ ] Complete subscriptions/payments and validate webhook origin, deduplication, amounts and credit grants before paid use.
- [ ] Finish operator handling for uncertain external outcomes, production privacy/retention and operational support flows.
- [ ] Deploy compatible web and persistent worker releases with database/Redis/storage, secrets and readiness monitoring.
- [ ] Demonstrate backup restoration, rollback and production end-to-end acceptance.

Full MVP: **INCOMPLETE**. Commercial launch: **BLOCKED BY OPEN GATES**. No production acceptance is claimed.
