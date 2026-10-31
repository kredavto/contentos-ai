# Disposable local verification

Requires macOS/Linux, a running local Docker Engine/Desktop, the Node version in package.json, pnpm 10.30.3 and installed workspace dependencies. The runner does not load `.env`. It creates a new database ending in `_test` and never reuses a supplied DATABASE_URL or TEST_DATABASE_URL. PostgreSQL and Redis bind only to loopback, with dynamically allocated host ports. Each run has random container names and a random local database password.

```sh
pnpm test:local
# Also rehearse database backup and restoration in the disposable container:
pnpm test:local --recovery
# Also build and run the complete browser MVP:
PLAYWRIGHT_CHANNEL=chrome pnpm test:local --e2e tests/e2e/onboarding.spec.ts
# All browser tests (requires a Playwright Chromium installation):
pnpm test:local --e2e
```

The default command builds/caches the small Docker FFmpeg image, starts disposable services, checks readiness and both media executables, applies migrations, then runs typecheck, lint and the complete unit/integration suite. The browser option builds the web app before regression and starts Playwright only after regression succeeds. Test-provider behavior comes from the existing browser fixture configuration; no live acceptance or production deployment is performed. Logs stream to the terminal. Playwright evidence remains in `test-results/`.

The optional `--recovery` flag precedes `--e2e` when combined. It adds a real PostgreSQL backup/restore rehearsal after typecheck/lint and before other tests, using separate source/restored databases inside the run's disposable container. A failure stops the run and still invokes cleanup. See [recovery checks and production limitations](database-recovery.md).

FFmpeg and ffprobe wrappers are generated inside a fresh temporary directory on every run, so they do not depend on old files under `/tmp`. The wrappers preserve paths containing spaces/quotes and pass media arguments as process argv. They pin the Node executable and local Docker Unix socket explicitly, so the providers can retain their restricted PATH/HOME environment. Remote Docker engines are rejected. The media container has no network, a read-only workspace mount and a writable mount limited to the run's temporary directory. It runs as root only within this disposable test fixture so Docker Desktop and Linux can write test media; the production worker remains unchanged.

Resources are removed after success, failed checks and SIGINT/SIGTERM. The runner signals the active process group, then removes only its own containers and anonymous volumes; it never prunes Docker or modifies development services. Cleanup failures result in a nonzero exit, name the affected containers and preserve the temporary directory. SIGKILL, host shutdown or Docker daemon loss can prevent cleanup; remove the printed run's containers manually in that case. The media image uses a unique per-run tag and that exact tag is removed during cleanup; Docker build layers may remain cached. After an interrupted host, remove only the affected run’s named resources, never use a global prune.

Browser fixtures still use fixed ports 1026, 8026, 8027, 3187 and 3190. The runner checks those ports before setup and refuses an occupied port. Run one browser verification at a time in a workspace. Redis is passed through TEST_REDIS_URL; CI and manual Playwright runs retain their existing localhost:6379/14 fallback. Separate database containers prevent integration workers from competing with a browser worker on another run, but builds and `test-results` still share the workspace and should not run concurrently.

First execution needs network access to fetch base images and install FFmpeg in the test image; subsequent image builds use Docker's cache. Set DOCKER_PATH only if Docker is installed outside PATH and the standard macOS location. Run with the pinned pnpm version; the runner reuses the invoking pnpm executable. Existing CI checks and manual test commands remain available.
