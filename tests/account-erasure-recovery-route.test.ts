import {randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {DomainError} from '../packages/types/src/index';
const fixture=vi.hoisted(()=>({session:vi.fn(),throttle:vi.fn(),retry:vi.fn(),eligibility:vi.fn(),request:vi.fn(),clearCookie:vi.fn()}));
vi.mock('../apps/web/node_modules/next/headers.js',()=>({cookies:async()=>({get:()=>({value:'synthetic-session'}),delete:fixture.clearCookie})}));
vi.mock('../apps/web/src/server/services',()=>({sessionCookie:'session',services:()=>({auth:{session:fixture.session,throttle:fixture.throttle},accountErasureRecovery:{retry:fixture.retry},accountErasure:{eligibility:fixture.eligibility,request:fixture.request},env:{APP_URL:'https://contentos.example',NODE_ENV:'production'}})}));
vi.mock('../apps/web/src/server/error-reporting',()=>({errorReporter:()=>({capture:vi.fn(),flush:async()=>true})}));
import {GET,POST} from '../apps/web/src/app/api/[...path]/route';
const user=randomUUID(),job=randomUUID(),origin='https://contentos.example';
async function call(method:'GET'|'POST',body?:unknown,includeOrigin=true){return ({GET,POST}[method])(new Request(origin+`/api/v1/admin/account-erasures/${job}/retry`,{method,headers:{'content-type':'application/json',...(includeOrigin?{origin}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:['v1','admin','account-erasures',job,'retry']})});}
beforeEach(()=>{vi.resetAllMocks();fixture.session.mockResolvedValue({userId:user});});
it('requires a session and Origin, throttles recovery and preserves the operator session',async()=>{
 expect((await call('POST',{},false)).status).toBe(403);expect(fixture.retry).not.toHaveBeenCalled();
 fixture.session.mockResolvedValue(null);expect((await call('POST',{})).status).toBe(401);expect(fixture.retry).not.toHaveBeenCalled();
 fixture.session.mockResolvedValue({userId:user});const input={expectedRecoveryId:null,idempotencyKey:randomUUID()};fixture.retry.mockResolvedValue({id:job,status:'QUEUED'});
 const response=await call('POST',input);expect(response.status).toBe(202);expect(response.headers.get('cache-control')).toBe('no-store');expect(fixture.retry).toHaveBeenCalledWith(user,job,input,expect.any(String));expect(fixture.throttle).toHaveBeenCalledWith('account-erasure-recovery',user);expect(fixture.throttle).toHaveBeenCalledWith('mutation',user);expect(fixture.clearCookie).not.toHaveBeenCalled();
 fixture.retry.mockRejectedValue(new DomainError('NOT_AUTHORIZED',403));expect((await call('POST',input)).status).toBe(403);
});
