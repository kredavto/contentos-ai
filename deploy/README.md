# Container release profiles

The root Dockerfile has `worker` and `web` targets. The worker includes FFmpeg, FFprobe and Cyrillic-capable fonts; the web image runs Next's standalone output. Both run as the unprivileged `node` user. Build contexts exclude runtime environment files, keys, `.vercel`, Git history, dependency caches and test artifacts.

Use a tested commit SHA as the image tag; retain the previous images for rollback. The base Node version and pnpm version are pinned in the Dockerfile. For a reproducible release, resolve and record the base image digest and the resulting image IDs before promotion. Never provide runtime secrets as Docker build arguments.

```sh
export CONTENTOS_IMAGE_TAG="$(git rev-parse HEAD)"
export RUNTIME_ENV_FILE=/absolute/protected/path/contentos.env
docker compose -f deploy/compose.production.yml build worker
# Run once against the selected deployment database BEFORE starting workers.
docker compose -f deploy/compose.production.yml run --rm migrate
docker compose -f deploy/compose.production.yml up -d worker
```

The protected runtime file uses the keys documented in `ENVIRONMENT.md`. Set NODE_ENV=production and a real HTTPS APP_URL. PostgreSQL, Redis, private S3 and SMTP must be reachable from the worker; web and worker use matching encryption keys. Do not use localhost database/Redis URLs inside a container unless the service actually shares that container. Production rejects mock AI/video/social/caption providers.

GLOBAL uses Vercel for the web application and this persistent worker on the selected host, with managed PostgreSQL/Redis/private S3. Give Vercel the corresponding server-only runtime values. Keep payment and generation flags disabled until provider configuration and operational checks pass.

RU_DATA_RESIDENCY uses the `self-hosted` profile and places web/API, PostgreSQL, Redis, media storage and workers in the selected Russian infrastructure. It does not make a legal-compliance claim by itself. Configure the provider/consent policy before external processing.

```sh
docker compose -f deploy/compose.production.yml --profile self-hosted build web
docker compose -f deploy/compose.production.yml --profile self-hosted up -d web worker
```

The self-hosted web binds only to host loopback port 3100. Put a trusted HTTPS reverse proxy in front of it and configure APP_URL to that exact origin. No database or Redis ports are exposed by this release file. Provision those services separately with network restrictions and tested encrypted backups. `/api/health` is web liveness; it does not prove database/provider readiness. The worker health check verifies its queue workers and Redis connection, not every provider or database operation.

The production compose file applies a read-only filesystem, dropped Linux capabilities, bounded CPU/memory, writable temporary volumes and graceful shutdown. `/tmp` must be large enough for the configured media limits and concurrency. Monitor disk/memory, pending jobs/email, provider errors and failed/reconciliation tasks. Test restore from a backup and a complete enabled-provider flow before directing real users to the release. Build/smoke verification status is recorded in `docs/IMPLEMENTATION_STATUS.md`.

Implementation references: [official Node images](https://hub.docker.com/_/node), [pnpm frozen installation](https://pnpm.io/cli/install), [Docker multi-stage builds](https://docs.docker.com/get-started/docker-concepts/building-images/multi-stage-builds/). The worker keeps workspace paths intact and installs production dependencies with the committed lockfile. It does not re-resolve ranges through legacy package deployment.

After building the worker image, run its offline media check with a read-only root filesystem. It asserts non-root execution, absence of a baked-in `.env`/development test runner, video normalization with Cyrillic captions, a JPEG cover and PCM audio extraction:

```sh
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m,uid=1000,gid=1000,mode=1770 \
  --cap-drop ALL --security-opt no-new-privileges \
  --mount "type=bind,source=$(pwd)/deploy/smoke-worker.mjs,target=/app/apps/worker/smoke-worker.mjs,readonly" \
  "contentos-worker:$CONTENTOS_IMAGE_TAG" node --import tsx smoke-worker.mjs
```

This does not contact an external provider or validate production credentials. Also test migration/startup on an isolated database and Redis before rolling out. Stop and remove only the smoke resources you created; never drop the deployment database during cleanup.

For a running web container configured with isolated PostgreSQL/Redis, mount `deploy/smoke-web.mjs` read-only at `/app/smoke-web.mjs` when starting it, then run `docker exec <smoke-container-name> node /app/smoke-web.mjs`. The check uses the container's loopback interface and needs no published port. It checks HTML, referenced CSS/JavaScript, liveness, registration rendering and the anonymous API's 401 response. It does not create accounts or prove SMTP/provider readiness.
