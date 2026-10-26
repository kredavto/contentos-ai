import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({check:vi.fn()}));
vi.mock('../apps/web/src/server/readiness',()=>({readinessService:()=>({check:fixture.check})}));
import {GET} from '../apps/web/src/app/api/health/ready/route';
beforeEach(()=>vi.resetAllMocks());
it('returns public no-store readiness independently of authenticated application services',async()=>{
 const result={status:'ready',checks:{database:'ok',redis:'ok',storage:'ok'}};fixture.check.mockResolvedValue(result);
 const response=await GET();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toEqual(result);
});
it('uses 503 for missing configuration or unavailable core dependencies',async()=>{
 const result={status:'not_ready',checks:{database:'ok',redis:'unavailable',storage:'configuration_required'}};fixture.check.mockResolvedValue(result);
 const response=await GET();expect(response.status).toBe(503);expect(await response.json()).toEqual(result);
});
