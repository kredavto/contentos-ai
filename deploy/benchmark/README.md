# Local draft: service-complete synthetic stack benchmark

Prepared against PR #19's verified tree be228268faa77a76a6801a5fcc816699aa34c0ea (published head 4c28abdf2d81b197f2d71c3480a2f7e304b16efb). The additional draft is restricted to the dedicated benchmark PR head and public-repository standard runners. No production/NL or other application services are used.

## What is automated

`run.sh` creates fresh, internally networked, explicitly owned worker, web, PostgreSQL, Redis, private S3-compatible storage and SMTP sink containers for each trial. It consumes six already-local immutable image IDs; it does not pull, build, publish, install on another host, or accept env files. The dedicated `.github/workflows/stack-benchmark.yml` uses digest-verified official images, a pinned official-source S3 build, one worker/web build shared by all trials, and a timeout. Results are log/summary-only: no artifact or cache storage is added. See FREE-RUN-PROVENANCE.md.

Three paired memory trials run in standard/economy, economy/standard, standard/economy order, plus a separate real-media SIGTERM/drain trial for each mode. Each trial uses one worker process, six jobs, fresh database/object storage, the same deterministic 1920x1080/30fps/6-second FFmpeg fixture, identical caps and code. Source hashes must match across all eight trials. A 10-second ready-idle sample precedes each 90-second load window. Fixed work must finish inside the load window, otherwise the run fails instead of omitting its later peak.

The worker fixture uses actual BullMQ queues, JobRepository/LedgerRepository, FFmpegMediaPreparation, S3StorageProvider round-trip checks and SmtpEmailProvider into a private sink. A private S3 network namespace exposes HTTP to the test worker on loopback, satisfying the existing adapter restriction without weakening it. The worker enforces NODE_ENV=test, a synthetic-only marker and exact dedicated DB/Redis endpoints. Production config and mock-provider prohibitions remain untouched. No external provider is contacted.

The fixture wraps six real media operations in the same shared gate and four-queue concurrency geometry as PR #19. It records queue-to-finish latency, processing time, peak concurrent admitted work, object output metadata/hash, completion count and fixed failure codes. Final application DB rows must be SUCCEEDED with one attempt each. S3 read-back hashes must match uploaded output; comparison requires the same normalized output media format and source hash across trials. Throughput and latency are reported alongside memory, so reduced throughput is visible.

Drain requires all six callbacks accepted AND a real FFmpeg process present before SIGTERM. The shared production pause/drain helper is exercised; exact worker stop uses a 120-second timeout and must exit 0 before that deadline, without OOMKilled/137. A fixture too short to observe active FFmpeg fails instead of pretending to test loaded drain. Forced interruption/recovery and a deliberately hung provider are not implemented in this draft.

## Measurement and bounds

The read-only host cgroup-v2 sampler measures worker (including FFmpeg descendants), web, DB, Redis, S3 and SMTP. It verifies exact labels/PIDs and refuses missing counters, restarts and disappearing cgroups. It records per-container current/peak/swap/events, sum of current at each nominal 100-ms sampling tick, observed read skew/gaps and sum of individual peaks as a separate upper bound. It does NOT claim an exact simultaneous parent-cgroup peak. Tmpfs/cache are already charged in cgroup memory and are not added twice. Swap and host overhead are separate.

Worker/web caps remain 3/1 GiB; fixture DB/Redis/S3/SMTP caps are 512/256/512/128 MiB. Swap limits equal RAM limits. These are identical bounded test conditions, not recommended production sizes. The runner requires at least 6.5 GiB currently available host RAM and refuses insufficient capacity rather than silently changing caps. Hardware, image IDs and memory availability are recorded. Hosted CI contention and cache/order effects still limit generalization. Individual cgroup peaks include startup and fixture generation, while sampled windows start after readiness.

## Deliberate representativeness limits

This is a full declared SERVICE SET with a synthetic PIPELINE, not full application traffic:
- It does not execute all real LibraryMedia/Image/Cover/Video processors or their remote-provider paths. Six operations use real media preparation under the shared gate and real generation-job ledger/state handling, rather than pretending mocked model output is a real vendor workflow.
- Web is running and included in RAM, but only health/idle, not authenticated upload/download/session concurrency. Fixture source loading and submission happen inside the worker process, adding its own measured overhead.
- Real S3 and SMTP transport are exercised, but the Mailpit inbox delivery count is not separately reconciled and no real mailbox receives messages.
- Six equal jobs and one small synthetic input do not establish production worst-case media behavior or an SLA. Long inputs, mixed job sizes, real model/vendor buffering, cancellation/failures, sustained traffic and forced-interruption reconciliation remain follow-up acceptance work.
- The 120-second test demonstrates only the completed fixture if it actually runs and passes; it is not a universal production drain guarantee.

A low fixture peak cannot justify deploying CONTENTOS on NL or shrinking production caps. The comparison JSON explicitly marks production_memory_budget_established=false and exact_simultaneous_peak_measured=false.

## Run and verification status

Required before any real execution: native Linux local Docker with readable cgroup-v2 counters; enough available memory; verified worker/web images from the exact candidate source; reviewed digest-pinned PostgreSQL/Redis/MinIO/Mailpit images. Official service digests and the official S3 source commit/module hashes were verified before publication. The source S3 build must verify module hashes and repeated binary equality before running. It needs a bounded existing standard runner, not a new paid resource.

Local checks completed: TypeScript (tests project including both fixtures), targeted ESLint, bash -n, Python compilation and 11 unit tests of sampler/comparison safety and arithmetic. The runner availability check failed before creating resources: benchmark_requires_native_linux_docker. No end-to-end Docker trial, memory measurement, throughput measurement or loaded drain has occurred. Shell orchestration and provider composition remain unverified until the first real run; unit tests are not a substitute.

User permission covers this separate draft and its free-only run. No merge/deploy is implied. PR #19, its prior successful CI, main and production remain unchanged. The current file records preparation; actual CI outcomes must be checked separately and must not be inferred from local checks.
