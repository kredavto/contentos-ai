import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { JobRepository } from '../../packages/db/src/index';
import { isolatedTestDatabase } from '../helpers/isolated-database';

// Opt-in only: this creates a separate migrated database and never dispatches jobs.
const enabled = process.env.CONTENTOS_DISPATCH_BENCHMARK === '1';
const url = process.env.TEST_DATABASE_URL;
if (enabled && !url) throw new Error('Benchmark requires TEST_DATABASE_URL');
if (enabled && url) {
  const target = new URL(url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !target.pathname.endsWith('_test')) {
    throw new Error('Benchmark requires a loopback disposable test database server');
  }
}
type Plan = Record<string, unknown>;
describe.skipIf(!enabled)('synthetic generation due-query benchmark', () => {
  const database = isolatedTestDatabase(url);
  const repository = new JobRepository(database.db);
  it('records original query plans before, during and after a test-only lease index', async () => {
    const user = randomUUID(), tenant = randomUUID(), workspace = randomUUID(), brand = randomUUID(), reservation = randomUUID();
    await database.client`insert into users(id,email,name,password_hash) values(${user},${user + '@example.test'},'Synthetic benchmark','unusable')`;
    await database.client`insert into organizations(id,name) values(${tenant},'Synthetic benchmark')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenant},'Synthetic benchmark')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brand},${tenant},${workspace},'Synthetic benchmark')`;
    await database.client`insert into usage_reservations(id,tenant_id,unit,amount,key) values(${reservation},${tenant},'AI_CREDITS',1,'synthetic-benchmark')`;
    await database.client`
      insert into jobs(tenant_id,brand_id,requested_by,type,status,input,input_hash,idempotency_key,reservation_id,provider,model,correlation_id,next_attempt_at,lease_expires_at)
      select ${tenant},${brand},${user},'GENERATE_SCRIPT',case when n<=50000 then 'SUCCEEDED' else 'RUNNING' end,
        '{}'::jsonb,'synthetic',gen_random_uuid(),${reservation},'mock','benchmark',gen_random_uuid(),
        now()-interval '1 day',case when n>100000 then now()-interval '1 day' else now()+interval '1 day' end
      from generate_series(1,100016) n`;
    await database.client`insert into outbox(tenant_id,job_id) select tenant_id,id from jobs`;
    await database.client`analyze jobs`;
    await database.client`analyze outbox`;

    // Capture the actual repository SQL via postgres.js; no copied predicate.
    let captured: { query: string; parameters: Parameters<typeof database.client.unsafe>[1] } | undefined;
    const oldDebug = database.client.options.debug;
    database.client.options.debug = (_connection, query, parameters) => {
      if (query.startsWith('select ') && query.includes('"outbox"')) captured = { query, parameters };
    };
    let original: Awaited<ReturnType<JobRepository['due']>>;
    try { original = await repository.due(); } finally { database.client.options.debug = oldDebug; }
    expect(original).toHaveLength(16);
    expect(captured).toBeDefined();
    if (!captured) throw new Error('Original repository query not captured');
    const query = captured;
    const ids = (rows: typeof original) => rows.map(row => row.id).sort();
    const expected = ids(original);
    const runs: Array<{ stage: string; samples: Plan[] }> = [];
    async function measure(stage: string) {
      expect(ids(await repository.due())).toEqual(expected); // Also warms query/data caches.
      const samples: Plan[] = [];
      for (let repeat = 0; repeat < 7; repeat++) {
        const rows = await database.client.unsafe(`explain (analyze, buffers, format json) ${query.query}`, query.parameters);
        const value: unknown = rows[0]?.['QUERY PLAN'];
        if (!Array.isArray(value) || typeof value[0] !== 'object' || value[0] === null) throw new Error('Missing JSON query plan');
        samples.push(value[0] as Plan);
      }
      runs.push({ stage, samples });
    }
    await measure('baseline');
    const buildStarted = performance.now();
    await database.client`create index benchmark_running_lease_idx on jobs(lease_expires_at) where status='RUNNING'`;
    const indexBuildMs = performance.now() - buildStarted;
    const [size] = await database.client`select pg_relation_size('benchmark_running_lease_idx')::text as bytes`;
    try { await measure('candidate_test_index'); }
    finally { await database.client`drop index benchmark_running_lease_idx`; }
    await measure('baseline_after_index_removed');
    const [version] = await database.client`select version() as version`;
    const report = {
      scope: 'Synthetic generation due SELECT only; not all dispatch queues or production traffic',
      limitations: ['Warm-cache sequential samples; not independent production trials', 'No worker/Redis/provider execution', 'No write-throughput benchmark', 'No query latency or speedup acceptance threshold'],
      fixture: { terminal: 50000, runningFutureLease: 50000, runningExpiredLease: 16, tenants: 1 },
      server: version?.version, sourceCommit: process.env.GITHUB_SHA ?? 'local', indexBuildMs, indexBytes: size?.bytes, runs,
    };
    await mkdir('test-results/dispatch-benchmark', { recursive: true });
    await writeFile('test-results/dispatch-benchmark/generation-due.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ event: 'synthetic_dispatch_benchmark_recorded', samplesPerStage: 7, expectedRows: 16, artifact: 'test-results/dispatch-benchmark/generation-due.json' }));
  }, 120000);
});
