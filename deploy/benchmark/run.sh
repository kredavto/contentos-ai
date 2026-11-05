#!/usr/bin/env bash
# Local/CI fixture only. Consumes verified LOCAL immutable image IDs; never pulls/builds/deploys.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
root=$PWD
[[ $(uname -s) == Linux && -S /var/run/docker.sock ]] || { echo 'benchmark_requires_native_linux_docker' >&2; exit 1; }
export DOCKER_HOST=unix:///var/run/docker.sock
unset DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH
for variable in BENCH_WORKER_IMAGE BENCH_WEB_IMAGE BENCH_POSTGRES_IMAGE BENCH_REDIS_IMAGE BENCH_S3_IMAGE BENCH_SMTP_IMAGE; do
  value=${!variable:-}
  [[ $value =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "benchmark_requires_local_image_id:$variable" >&2; exit 1; }
  [[ $(docker image inspect --format '{{.Id}}' "$value") == "$value" ]] || exit 1
done
# Bound all fixture containers; leave explicit host headroom. No auto-downsizing.
python3 - <<'CAPACITY'
from pathlib import Path
m={k:int(v.split()[0])*1024 for k,v in (line.split(':',1) for line in Path('/proc/meminfo').read_text().splitlines())}
assert m['MemAvailable']>=int(6.5*1024**3), 'insufficient available host RAM for bounded fixture stack'
CAPACITY
# Output is exclusive to this run, outside the repository.
result=$(mktemp -d /tmp/contentos-benchmark-results.XXXXXX)
printf '%s\n' "$result"
python3 - "$result/provenance.json" <<'PROVENANCE'
import json,os,platform,sys
from pathlib import Path
json.dump({'images':{k:os.environ[k] for k in ['BENCH_WORKER_IMAGE','BENCH_WEB_IMAGE','BENCH_POSTGRES_IMAGE','BENCH_REDIS_IMAGE','BENCH_S3_IMAGE','BENCH_SMTP_IMAGE']},'kernel':platform.release(),'architecture':platform.machine(),'host_cpu_count':os.cpu_count(),'meminfo':Path('/proc/meminfo').read_text(),'scope':'synthetic service-complete pipeline, not full application traffic'},open(sys.argv[1],'x'),indent=2)
PROVENANCE
prefix='';network='';owned=();sampler=''
cleanup(){
  local failed=0
  if [[ -n $sampler ]]; then kill "$sampler" 2>/dev/null || true;wait "$sampler" 2>/dev/null || true;sampler='';fi
  for name in "${owned[@]}"; do
    if docker container inspect "$name" >/dev/null 2>&1; then
      [[ $(docker inspect --format '{{index .Config.Labels "contentos.benchmark.owner"}}' "$name") == "$prefix" ]] || { failed=1;continue; }
      docker rm -fv "$name" >/dev/null || failed=1
    fi
  done
  if [[ -n $network ]];then
    if [[ $(docker network inspect --format '{{index .Labels "contentos.benchmark.owner"}}' "$network") == "$prefix" ]];then docker network rm "$network" >/dev/null || failed=1;else failed=1;fi
  fi
  owned=();network='';return "$failed"
}
trap 'code=$?;trap - EXIT;cleanup || code=1;exit "$code"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
ready(){ local count;for ((count=0;count<90;count++));do if "$@" >/dev/null 2>&1;then return;fi;sleep 1;done;echo benchmark_readiness_failed >&2;return 1; }
start(){ local role=$1;shift;owned+=("$prefix-$role");docker run -d --pull never --name "$prefix-$role" --label "contentos.benchmark.owner=$prefix" "$@" >/dev/null; }
worker_request(){ docker exec "$prefix-worker" node -e "fetch('http://127.0.0.1:3191/$1',{method:'$2',signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)process.exit(1);console.log(await r.text())}).catch(()=>process.exit(1))"; }
trial(){
  local mode=$1 phase=$2 number=$3
  prefix="contentos-bench-$(python3 -c 'import secrets;print(secrets.token_hex(6))')";network="$prefix-network"
  docker network create --internal --label "contentos.benchmark.owner=$prefix" "$network" >/dev/null
  local dir="$result/$number-$mode-$phase";mkdir "$dir"
  start postgres --memory 512m --memory-swap 512m --network "$network" --network-alias postgres -e POSTGRES_USER=contentos -e POSTGRES_PASSWORD=fixture-only -e POSTGRES_DB=contentos_benchmark_test "$BENCH_POSTGRES_IMAGE"
  start redis --memory 256m --memory-swap 256m --network "$network" --network-alias redis "$BENCH_REDIS_IMAGE"
  start s3 --memory 512m --memory-swap 512m --network "$network" --network-alias s3 -e MINIO_ROOT_USER=fixture-access -e MINIO_ROOT_PASSWORD=fixture-secret-not-production "$BENCH_S3_IMAGE" server /data --address :9000
  start smtp --memory 128m --memory-swap 128m --network "$network" --network-alias smtp "$BENCH_SMTP_IMAGE"
  ready docker exec "$prefix-postgres" pg_isready -U contentos -d contentos_benchmark_test
  ready docker exec "$prefix-redis" redis-cli ping
  local db='postgresql://contentos:fixture-only@postgres:5432/contentos_benchmark_test'
  owned+=("$prefix-migrate")
  docker run --rm --pull never --name "$prefix-migrate" --label "contentos.benchmark.owner=$prefix" --network "$network" -e DATABASE_URL="$db" "$BENCH_WORKER_IMAGE" node --import tsx node_modules/@contentos/db/src/migrate.ts >/dev/null
  local security=(--read-only --cap-drop ALL --security-opt no-new-privileges --init)
  start web --network "$network" "${security[@]}" --memory 1g --memory-swap 1g --cpus 1 --tmpfs /tmp:rw,noexec,nosuid,size=128m,uid=1000,gid=1000,mode=1770 --tmpfs /app/apps/web/.next/cache:rw,noexec,nosuid,size=256m,uid=1000,gid=1000,mode=1770 -e NODE_ENV=production -e APP_URL=https://benchmark.invalid -e DATABASE_URL="$db" -e REDIS_URL=redis://redis:6379/14 -e AI_PROVIDER=disabled -e STORAGE_PROVIDER=disabled "$BENCH_WEB_IMAGE"
  # S3's private network namespace gives the TEST fixture loopback HTTP; no guard is weakened.
  owned+=("$prefix-probe")
  ready docker run --rm --pull never --name "$prefix-probe" --label "contentos.benchmark.owner=$prefix" --network "container:$prefix-s3" "$BENCH_WORKER_IMAGE" node -e "fetch('http://127.0.0.1:9000/minio/health/live',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  start worker --network "container:$prefix-s3" "${security[@]}" --memory 3g --memory-swap 3g --cpus 2 --tmpfs /tmp:rw,noexec,nosuid,size=2g,uid=1000,gid=1000,mode=1770 -e NODE_ENV=test -e CONTENTOS_BENCHMARK=synthetic-only -e WORKER_RESOURCE_PROFILE="$mode" -e DATABASE_URL="$db" -e REDIS_URL=redis://redis:6379/14 --mount "type=bind,source=$root/apps/worker/test/stack-benchmark.ts,target=/app/apps/worker/test/stack-benchmark.ts,readonly" --mount "type=bind,source=$root/packages/providers/test/benchmark-bucket.ts,target=/app/packages/providers/test/benchmark-bucket.ts,readonly" "$BENCH_WORKER_IMAGE" node --import tsx test/stack-benchmark.ts
  ready worker_request status GET
  ready docker exec "$prefix-web" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
  worker_request status GET > "$dir/before.json"
  if [[ $phase == memory ]]; then
    python3 deploy/benchmark/sample_cgroups.py --owner "$prefix" --roles worker,web,postgres,redis,s3,smtp --seconds 10 --output "$dir/idle.json"
    python3 deploy/benchmark/sample_cgroups.py --owner "$prefix" --roles worker,web,postgres,redis,s3,smtp --seconds 90 --output "$dir/load.json" > "$dir/sampler.log" 2>&1 & sampler=$!
    sleep 1;worker_request run POST >/dev/null
    wait "$sampler";sampler=''
    worker_request status GET > "$dir/after.json"
    python3 - "$dir/after.json" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert r['finished']==6 and not r['errors'], 'incomplete fixed work: memory window insufficient or processing failed'
PY
  else
    worker_request run POST >/dev/null
    ready docker exec "$prefix-worker" node -e "fetch('http://127.0.0.1:3191/status',{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(j=>process.exit(j.admitted===6&&j.active>0?0:1)).catch(()=>process.exit(1))"
    # Require a real FFmpeg process, not merely an active JS callback.
    ready docker exec "$prefix-worker" node -e "const f=require('fs');process.exit(f.readdirSync('/proc').some(p=>{try{return /^\\d+$/.test(p)&&f.readFileSync('/proc/'+p+'/comm','utf8').trim()==='ffmpeg'}catch{return false}})?0:1)"
  fi
  local began=$SECONDS
  docker stop --time 120 "$prefix-worker" >/dev/null
  [[ $(docker inspect --format '{{.State.ExitCode}} {{.State.OOMKilled}}' "$prefix-worker") == '0 false' ]] || { echo benchmark_drain_failed >&2;return 1; }
  [[ $((SECONDS-began)) -lt 120 ]] || { echo benchmark_drain_deadline_failed >&2;return 1; }
  docker logs "$prefix-worker" 2>/dev/null | python3 -c 'import sys,json;rows=[]
for line in sys.stdin:
 try:
  r=json.loads(line)
  if r.get("event")=="benchmark_result":rows.append(r)
 except ValueError:pass
assert len(rows)==1
print(json.dumps(rows[0]))' > "$dir/final.json"
  printf '{"wall_seconds":%d,"exit_code":0,"forced_kill":false}\n' "$((SECONDS-began))" > "$dir/drain.json"
  cleanup
}
# Three paired trials with reversed order to expose cache/host-order bias.
index=0
for mode in standard economy economy standard standard economy;do index=$((index+1));trial "$mode" memory "$index";done
for mode in standard economy;do index=$((index+1));trial "$mode" drain "$index";done
python3 deploy/benchmark/compare.py "$result" > "$result/comparison.json"
echo "benchmark_evidence:$result"
