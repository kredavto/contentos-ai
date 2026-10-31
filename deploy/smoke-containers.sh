#!/usr/bin/env bash
# Isolated fixture-only acceptance. Never source deployment environment files.
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
run_id="${GITHUB_RUN_ID:-local}-revision-${GITHUB_RUN_ATTEMPT:-1}-$$"
prefix="contentos-smoke-${run_id}"
network="${prefix}-network"
postgres="${prefix}-postgres"
redis="${prefix}-redis"
worker="${prefix}-worker"
web="${prefix}-web"
migrate="${prefix}-migrate"
media="${prefix}-media"
worker_image="${prefix}:worker"
web_image="${prefix}:web"
cleanup() {
  local result=$?
  trap - EXIT INT TERM
  # Exact owned names only. No global prune, label-wide deletion or deployment volumes.
  docker rm -fv "$web" "$worker" "$migrate" "$media" "$postgres" "$redis" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  docker image rm "$web_image" "$worker_image" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
fail() { printf '%s\n' "container_smoke_failed:$1" >&2; exit 1; }
wait_for() {
  local name=$1; shift
  for ((attempt=0; attempt<60; attempt++)); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  fail "$name"
}
# Capture only bounded fixture logs. Never emit logs or raw Docker inspect/env output.
check_worker_events() {
  docker logs --tail 200 "$worker" 2>&1 | node deploy/check-worker-smoke-logs.mjs || fail worker_operational_error
}
docker version >/dev/null
# No runtime --build-arg, --secret or env-file is accepted by this runner.
docker build --target worker --tag "$worker_image" .
docker build --target web --tag "$web_image" .
printf '%s\n' 'container_smoke:images_built'
docker image inspect --format '{{.Id}}' "$worker_image" "$web_image"
hardening=(--read-only --cap-drop ALL --security-opt no-new-privileges --init)
docker run --rm --name "$media" --network none "${hardening[@]}" \
  --tmpfs /tmp:rw,noexec,nosuid,size=256m,uid=1000,gid=1000,mode=1770 \
  --mount "type=bind,source=$root/deploy/smoke-worker.mjs,target=/app/apps/worker/smoke-worker.mjs,readonly" \
  "$worker_image" node --import tsx smoke-worker.mjs
# Runtime containers cannot reach the Internet and expose no host ports.
docker network create --internal "$network" >/dev/null
docker run -d --name "$postgres" --network "$network" --network-alias postgres \
  -e POSTGRES_USER=contentos -e POSTGRES_PASSWORD=ci-container-fixture-only -e POSTGRES_DB=contentos_container_test \
  postgres:17-alpine >/dev/null
docker run -d --name "$redis" --network "$network" --network-alias redis redis:7-alpine >/dev/null
wait_for postgres_ready docker exec "$postgres" pg_isready -U contentos -d contentos_container_test
wait_for redis_ready docker exec "$redis" redis-cli ping
runtime=(--network "$network" "${hardening[@]}" \
  -e NODE_ENV=production -e APP_URL=https://container-smoke.invalid \
  -e DATABASE_URL=postgresql://contentos:ci-container-fixture-only@postgres:5432/contentos_container_test \
  -e REDIS_URL=redis://redis:6379/0 \
  -e AI_PROVIDER=disabled -e VIDEO_PROVIDER=disabled -e AVATAR_PROVIDER=disabled \
  -e IMAGE_PROVIDER=disabled -e SOCIAL_PROVIDER=disabled -e CAPTION_PROVIDER=disabled -e STORAGE_PROVIDER=disabled)
# Same entrypoint as the production migration service, twice BEFORE workers/web start.
for pass in 1 2; do
  docker run --rm --name "$migrate" "${runtime[@]}" \
    --tmpfs /tmp:rw,noexec,nosuid,size=128m,uid=1000,gid=1000,mode=1770 \
    "$worker_image" node --import tsx node_modules/@contentos/db/src/migrate.ts
  printf 'container_smoke:migration_pass_%s\n' "$pass"
done
docker run -d --name "$worker" "${runtime[@]}" --memory 3g --cpus 2 \
  --tmpfs /tmp:rw,noexec,nosuid,size=2g,uid=1000,gid=1000,mode=1770 "$worker_image" >/dev/null
docker run -d --name "$web" "${runtime[@]}" --memory 1g --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,size=128m,uid=1000,gid=1000,mode=1770 \
  --tmpfs /app/apps/web/.next/cache:rw,noexec,nosuid,size=256m,uid=1000,gid=1000,mode=1770 \
  --mount "type=bind,source=$root/deploy/smoke-web.mjs,target=/app/smoke-web.mjs,readonly" "$web_image" >/dev/null
wait_for worker_health docker exec "$worker" node -e "fetch('http://127.0.0.1:3190/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
wait_for web_health docker exec "$web" node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
docker exec "$web" node /app/smoke-web.mjs
# Observe multiple two-second dispatch/email polling cycles against the migrated fixture DB.
sleep 6
check_worker_events
# SIGTERM must complete before timeout; Docker's forced-kill exit 137 is not acceptance.
docker stop --time 30 "$worker" >/dev/null
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$worker")" == 0 ]] || fail worker_graceful_stop
printf '%s\n' 'container_smoke:passed (packaging, offline media, migrations, session lookup, startup; not live readiness)'
