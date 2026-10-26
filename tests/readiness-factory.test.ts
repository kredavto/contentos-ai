import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({database:vi.fn(),redis:vi.fn(),storage:vi.fn(),storageFactory:vi.fn()}));
vi.mock('../apps/web/node_modules/@contentos/core/src/index.ts',async()=>({ReadinessService:(await import('../packages/core/src/readiness')).ReadinessService}));
vi.mock('../apps/web/node_modules/@contentos/db/src/index.ts',()=>({probeDatabase:fixture.database}));
vi.mock('../apps/web/node_modules/@contentos/providers/src/index.ts',()=>({probeRedis:fixture.redis,storageFromEnvironment:fixture.storageFactory}));
import {createReadinessService} from '../apps/web/src/server/readiness';
const env={DATABASE_URL:'postgresql://fixture:password-sentinel@127.0.0.1/fixture_test',REDIS_URL:'redis://127.0.0.1:6379/14',STORAGE_PROVIDER:'s3'};
beforeEach(()=>{vi.resetAllMocks();fixture.database.mockResolvedValue(undefined);fixture.redis.mockResolvedValue(undefined);fixture.storage.mockResolvedValue(undefined);fixture.storageFactory.mockReturnValue({ready:fixture.storage});});
it('checks only core dependencies, independently of missing or invalid external-provider configuration',async()=>{
 const result=await createReadinessService({...env,AI_PROVIDER:'unavailable',OPENAI_API_KEY:'',HEYGEN_API_KEY:'',PAYMENT_PROVIDER:'unavailable',SMTP_URL:''}).check();expect(result.status).toBe('ready');expect(fixture.database).toHaveBeenCalledWith(env.DATABASE_URL,expect.any(AbortSignal));expect(fixture.redis).toHaveBeenCalledWith(env.REDIS_URL,expect.any(AbortSignal));expect(fixture.storage).toHaveBeenCalledWith(expect.any(AbortSignal));expect(JSON.stringify(result)).not.toMatch(/password-sentinel|127\.0\.0\.1/);
});
it('classifies absent or malformed endpoints without opening unintended connections',async()=>{
 fixture.storageFactory.mockReturnValue(null);const result=await createReadinessService({DATABASE_URL:'https://private.example/path',REDIS_URL:'file:///private'}).check();expect(result).toEqual({status:'not_ready',checks:{database:'configuration_required',redis:'configuration_required',storage:'configuration_required'}});expect(fixture.database).not.toHaveBeenCalled();expect(fixture.redis).not.toHaveBeenCalled();
});
it('reports invalid storage configuration separately from healthy database and Redis',async()=>{
 fixture.storageFactory.mockImplementation(()=>{throw new Error('secret-endpoint-sentinel');});const result=await createReadinessService(env).check();expect(result).toEqual({status:'not_ready',checks:{database:'ok',redis:'ok',storage:'configuration_required'}});expect(JSON.stringify(result)).not.toContain('secret-endpoint-sentinel');
});
