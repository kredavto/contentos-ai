import {beforeEach,expect,it,vi} from 'vitest';
import {DomainError} from '../packages/types/src/index';
const fixture=vi.hoisted(()=>({
 session:vi.fn(),verify:vi.fn(),register:vi.fn(),login:vi.fn(),logout:vi.fn(),requestToken:vi.fn(),reset:vi.fn(),
 get:vi.fn(),set:vi.fn(),remove:vi.fn(),capture:vi.fn(),flush:vi.fn(async()=>true),
}));
vi.mock('../apps/web/node_modules/next/headers.js',()=>({cookies:async()=>({get:fixture.get,set:fixture.set,delete:fixture.remove})}));
vi.mock('../apps/web/src/server/services',()=>({sessionCookie:'fixture-session',services:()=>({
 auth:fixture,env:{APP_URL:'https://contentos.example',NODE_ENV:'production'},
})}));
vi.mock('../apps/web/src/server/error-reporting',()=>({errorReporter:()=>({capture:fixture.capture,flush:fixture.flush})}));
import {GET,POST} from '../apps/web/src/app/api/[...path]/route';
const origin='https://contentos.example';
async function call(path:string,method:'GET'|'POST'='GET',body?:unknown,withOrigin=true){
 const request=new Request(`${origin}/api/${path}`,{method,headers:{...(method==='POST'?{'content-type':'application/json'}:{}),...(withOrigin?{origin}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return (method==='GET'?GET:POST)(request,{params:Promise.resolve({path:path.split('/')})});
}
beforeEach(()=>{
 vi.resetAllMocks();fixture.get.mockReturnValue({value:'fixture-token'});fixture.session.mockResolvedValue(null);
 fixture.verify.mockResolvedValue({verified:true});fixture.register.mockResolvedValue({verificationRequired:true});
 fixture.requestToken.mockResolvedValue({accepted:true});fixture.reset.mockResolvedValue({reset:true});
 fixture.login.mockResolvedValue({token:'fixture-session-token',expiresAt:new Date(Date.now()+60000)});
});
it('serves canonical session and legacy session with the same safe envelope',async()=>{
 fixture.session.mockResolvedValue({userId:'fixture-user',name:'Fixture'});
 for(const path of ['v1/auth/session','me']){
  const response=await call(path);expect(fixture.capture.mock.calls).toEqual([]);expect(response.status).toBe(200);
  expect(await response.json()).toEqual({data:{userId:'fixture-user',name:'Fixture'},meta:{requestId:response.headers.get('x-request-id')},error:null});
  expect(response.headers.get('cache-control')).toBe('no-store');
 }
 expect(fixture.session).toHaveBeenCalledWith('fixture-token');
});
it('keeps every required versioned authentication command behind the Origin guard',async()=>{
 for(const path of ['register','login','logout','forgot-password','reset-password','verify-email']){
  expect((await call(`v1/auth/${path}`,'POST',{},false)).status).toBe(403);
 }
 for(const action of [fixture.register,fixture.login,fixture.logout,fixture.requestToken,fixture.reset,fixture.verify])expect(action).not.toHaveBeenCalled();
});
it('dispatches canonical auth commands and preserves secure cookie behavior',async()=>{
 for(const [path,status] of [['register',202],['forgot-password',202],['reset-password',200],['verify-email',200],['login',200],['logout',200]] as const){
  const response=await call(`v1/auth/${path}`,'POST',{fixture:true});expect(response.status).toBe(status);
  const body=await response.json();expect(body.error).toBeNull();expect(body.meta.requestId).toBe(response.headers.get('x-request-id'));
 }
 expect(fixture.verify).toHaveBeenCalledWith({fixture:true},expect.any(String),expect.any(String));
 expect(fixture.requestToken).toHaveBeenCalledWith({fixture:true},'RESET_PASSWORD',expect.any(String),expect.any(String));
 expect(fixture.set).toHaveBeenCalledWith('fixture-session','fixture-session-token',expect.objectContaining({httpOnly:true,secure:true,sameSite:'lax',path:'/'}));
 expect(fixture.remove).toHaveBeenCalledWith('fixture-session');
});
it('retains the legacy verification path without treating aliases as separate authorization paths',async()=>{
 const response=await call('auth/verify','POST',{token:'fixture-token'});expect(response.status).toBe(200);
 expect(fixture.verify).toHaveBeenCalledOnce();
});
it('correlates versioned errors and rejects unknown versions without dispatch',async()=>{
 for(const path of ['v2/auth/register','v1','v1/v1/auth/register']){
  const response=await call(path,'POST',{});expect(response.status).toBe(404);
  expect((await response.json()).data).toBeNull();
 }
 expect(fixture.register).not.toHaveBeenCalled();
 const unauthorized=await call('v1/auth/session');expect(unauthorized.status).toBe(401);
 const body=await unauthorized.json();expect(body.data).toBeNull();expect(body.error.requestId).toBe(unauthorized.headers.get('x-request-id'));expect(body.error.correlationId).toBe(body.error.requestId);
 fixture.verify.mockRejectedValue(new DomainError('RATE_LIMITED',429));
 const limited=await call('v1/auth/verify-email','POST',{});expect(limited.status).toBe(429);expect(limited.headers.get('retry-after')).toBe('900');
});
