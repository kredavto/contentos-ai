# Experimental single-process economy profile

Base: production/main 64288d98c2f6fcef30b4ac8ffe8f55cf6e9585e9, verified 2026-11-05.
Local candidate only. Not deployed or published. No measured full-stack RAM saving.

## Contract

WORKER_RESOURCE_PROFILE defaults to `standard`. Only `standard` and `economy` are accepted; invalid configuration fails before database/Redis creation and never echoes its value. `deploy/compose.economy.yml` is an opt-in overlay; no memory or tmpfs cap is reduced.

Economy mode shares one FIFO admission slot across library-media, images, covers and generation processors in ONE Node process. Generation includes text, avatar and video tasks. Whole processors are serialized conservatively, including network waits. This reduces throughput and can delay small text requests behind media requests. Payment, publishing, analytics and other queues retain their current behavior and can still consume memory concurrently. There is no distributed limit and no full application memory budget. Multiple replicas each get their own slot; acceptance requires exactly one worker process/replica.

Admission wraps each processor before its database claim, provider call, input download or FFmpeg invocation. No queue names, IDs, attempts, retry/backoff settings, database lease logic or external idempotency rules change. BullMQ still considers waiting callbacks active and normally renews their queue locks. Current four queue concurrencies bound callbacks to six (three generation plus three other queues), hence at most five gate waiters in current wiring. No promise timeout can release the slot early while underlying work continues. Exceptions and return values propagate unchanged; `finally` transfers the slot to the next waiter. The gate must not be acquired recursively by a processor.

## Failure and shutdown review

An unsettled processor intentionally blocks later heavy work; the gate does not invent cancellation or replay uncertain provider submissions. Existing FFmpeg execution has bounded subprocess timeouts, but that is not proof that every complete processor path is bounded. Cold starts, provider waits, shutdown and force-kill recovery require real integration acceptance.

Shutdown now clears dispatch timers, pauses intake on all four heavy workers concurrently, then drains their accepted callbacks concurrently through a shared helper. Waiting callbacks must drain, and serialization can still extend drain time beyond the current 120-second container grace. Do not enable this profile in production until a real Redis/PostgreSQL run validates active job lock renewal, domain leases, FIFO progress after failure, SIGTERM draining with all four queues populated, and safe reconciliation after forced interruption. Do not blindly enlarge timeouts or release a live operation's slot as a workaround.

## Local verification scope

Eight focused unit/wiring tests cover default/invalid configuration, unchanged standard concurrency, six-delivery serialization, exact rejection propagation, failure drain, no early slot release, FIFO reservation and source wiring. These are not real BullMQ integration tests.

Local dependencies were reused from the existing checkout with an identical pnpm lockfile; workspace package links point to this exact production-base checkout. A fresh offline pnpm installation could not finish because offline metadata for @alloc/quick-lru was absent. No packages were downloaded or installed on NL.

A real full-stack RAM measurement is still required: simultaneous process-tree/PSS or cgroup memory, tmpfs usage, Redis/PostgreSQL, worst permitted media inputs and sustained concurrent queue submissions. Existing small synthetic media tests are not a RAM budget. No production secrets, data, services or mailer components are used by this candidate.

Completed local results (2026-11-05): focused 8/8 passed; complete available Vitest run 528 passed / 550 skipped (83 passed / 56 skipped files, 52.99 seconds); worker TypeScript check passed; tests TypeScript check passed; targeted ESLint passed; git diff --check passed. Skipped integration/media cases were not silently counted as passing. No real Redis/PostgreSQL/BullMQ lock-renewal, full-stack RAM or container shutdown measurement was performed. Production image build and deployment were not attempted.


## Real-service integration gate (prepared, not executed here)

The existing validate workflow already provisions Redis 7 and PostgreSQL 17 and migrates the fixture database. A new explicit step invokes `tests/integration/worker-economy.integration.test.ts` with REQUIRE_ECONOMY_INTEGRATION=1. Missing TEST_DATABASE_URL or TEST_REDIS_URL is then a failed suite, not a skip. The standard pnpm test discovery also includes the file. No new paid resources, provider credentials or deployment actions are introduced.

Two child-process scenarios use actual BullMQ Workers/Queues and the application JobRepository/LedgerRepository against the dedicated contentos_test database and Redis DB 14. Six accepted deliveries across four uniquely named queues wait through 3.2 seconds with one-second queue locks; the parent checks positive lock TTL, attemptsStarted=1, exactly one DB claim, and no stalls. Actual SIGTERM invokes the same pause/drain helper as production; subsequent release must yield six single-attempt domain outcomes and queue completions, with either zero failures or exactly one injected terminal failure. Queue cleanup touches only UUID-prefixed owned queues. Synthetic database rows remain in the disposable fixture database, as with other integration suites; the CI service lifecycle discards them. On timeout the parent terminates only its own child.

This fixture exercises real queue locking and domain claims, not the complete production entrypoint, all four different domain processors, remote providers, long-running domain heartbeat expiry, container force-kill/reconciliation, or a workload exceeding the production grace period. These remain release acceptance requirements. Heavy gate tests cannot prove a whole-stack RAM budget.

Locally the required-fixture command was intentionally executed without service URLs and failed with exit 1, confirming fail-closed wiring. No genuine integration pass or cloud workflow run is claimed. Earlier 528-pass regression belongs to the first candidate; updated results are reported separately.

Updated candidate verification: targeted lint and worker/tests TypeScript passed after fixture edits. Full local Vitest: 530 passed / 552 skipped; the two new real-service integration cases are explicitly among the skipped tests because fixture services are absent. The workflow invocation and required-environment guard were checked locally, but no workflow was published, dispatched or observed passing for this candidate.
