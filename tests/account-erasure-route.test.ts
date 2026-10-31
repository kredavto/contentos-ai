import {randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {DomainError} from '../packages/types/src/index';
const fixture=vi.hoisted(()=>({session:vi.fn(),throttle:vi.fn(),eligibility:vi.fn(),request:vi.fn(),clearCookie:vi.fn()}));
vi.mock('../apps/web/node_modules/next/headers.js',()=>({cookies:async()=>({get:()=>({value:'synthetic-session'}),delete:fixture.clearCookie})}));
vi.mock('../apps/web/src/server/services',()=>({sessionCookie:'session',services:()=>({auth:{session:fixture.session,throttle:fixture.throttle},accountErasure:{eligibility:fixture.eligibility,request:fixture.request},env:{APP_URL:'https://contentos.example',NODE_ENV:'production'}})}));
vi.mock('../apps/web/src/server/error-reporting',()=>({errorReporter:()=>({capture:vi.fn(),flush:async()=>true})}));
import {GET,POST} from '../apps/web/src/app/api/[...path]/route';
const user=randomUUID(),origin='https://contentos.example';
async function call(method:'GET'|'POST',body?:unknown,includeOrigin=true){return ({GET,POST}[method])(new Request(origin+'/api/v1/privacy/erasure',{method,headers:{'content-type':'application/json',...(includeOrigin?{origin}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:['v1','privacy','erasure']})});}
beforeEach(()=>{vi.resetAllMocks();fixture.session.mockResolvedValue({userId:user});});
it('authorizes and throttles eligibility reads with no-store responses',async()=>{
 fixture.eligibility.mockResolvedValue({available:true,eligible:false,resourceReview:true,mailReview:false});
 const response=await call('GET');expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(fixture.eligibility).toHaveBeenCalledWith(user);expect(fixture.throttle).toHaveBeenCalledWith('account-erasure-read',user);
 fixture.session.mockResolvedValue(null);expect((await call('GET')).status).toBe(401);
});
it('does not execute or clear cookies without a session and same-origin confirmation',async()=>{
 expect((await call('POST',{},false)).status).toBe(403);expect(fixture.request).not.toHaveBeenCalled();expect(fixture.clearCookie).not.toHaveBeenCalled();
 fixture.session.mockResolvedValue(null);expect((await call('POST',{})).status).toBe(401);expect(fixture.request).not.toHaveBeenCalled();
});
it('clears the browser session only after the durable confirmation succeeds',async()=>{
 const input={requestId:randomUUID(),scope:'ACCOUNT_AUTH_DATA_V1'},id=randomUUID();fixture.request.mockRejectedValue(new DomainError('CONFLICT',409));expect((await call('POST',input)).status).toBe(409);expect(fixture.clearCookie).not.toHaveBeenCalled();
 fixture.request.mockResolvedValue({id,status:'QUEUED'});const response=await call('POST',input);expect(response.status).toBe(202);expect(fixture.request).toHaveBeenLastCalledWith(user,input,expect.any(String));expect(fixture.clearCookie).toHaveBeenCalledWith('session');expect(fixture.throttle).toHaveBeenCalledWith('account-erasure',user);
});
