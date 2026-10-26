import {describe,expect,it} from 'vitest';
import {probeDatabase} from '../packages/db/src/readiness';
import {probeRedis} from '../packages/providers/src/redis-readiness';
const databaseUrl=process.env.TEST_DATABASE_URL,redisUrl=process.env.TEST_REDIS_URL;
describe.skipIf(!databaseUrl||!redisUrl)('read-only dependency probes',()=>{
 it('pings the dedicated database and Redis without changing application state',async()=>{if(!new URL(databaseUrl!).pathname.endsWith('_test'))throw new Error('Dedicated test database required');await probeDatabase(databaseUrl!,AbortSignal.timeout(1500));await probeRedis(redisUrl!,AbortSignal.timeout(1500));});
});
it('declines already aborted probes before creating connections',async()=>{
 const signal=AbortSignal.abort();await expect(probeDatabase('invalid',signal)).rejects.toThrow();await expect(probeRedis('invalid',signal)).rejects.toThrow();
});
it('closes failed loopback probes without reconnecting indefinitely',async()=>{
 await expect(probeDatabase('postgresql://fixture:fixture@127.0.0.1:1/unused_test',AbortSignal.timeout(1500))).rejects.toThrow();await expect(probeRedis('redis://127.0.0.1:1',AbortSignal.timeout(1500))).rejects.toThrow();
});
