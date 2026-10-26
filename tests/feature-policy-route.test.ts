import {randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({session:vi.fn(),throttle:vi.fn(),overview:vi.fn(),inspect:vi.fn(),change:vi.fn()}));
vi.mock('../apps/web/node_modules/next/headers.js',()=>({cookies:async()=>({get:()=>({value:'synthetic-session'})})}));
vi.mock('../apps/web/src/server/services',()=>({sessionCookie:'session',services:()=>({auth:{session:fixture.session,throttle:fixture.throttle},featurePolicy:{overview:fixture.overview,inspect:fixture.inspect,change:fixture.change},env:{APP_URL:'https://contentos.example',NODE_ENV:'production'}})}));
vi.mock('../apps/web/src/server/error-reporting',()=>({errorReporter:()=>({capture:vi.fn(),flush:async()=>true})}));
import {GET,POST} from '../apps/web/src/app/api/[...path]/route';
const user=randomUUID(),origin='https://contentos.example';
async function call(method:'GET'|'POST',path:string[],body?:unknown,includeOrigin=true,query=''){return ({GET,POST}[method])(new Request(origin+'/api/v1/'+path.join('/')+query,{method,headers:{'content-type':'application/json',...(includeOrigin?{origin}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:['v1',...path]})});}
beforeEach(()=>{vi.resetAllMocks();fixture.session.mockResolvedValue({userId:user});});
it('requires session and Origin before applying a rule, with no-store and mutation budgets',async()=>{
 const path=['admin','feature-policy'];expect((await call('POST',path,{},false)).status).toBe(403);expect(fixture.change).not.toHaveBeenCalled();fixture.session.mockResolvedValue(null);expect((await call('POST',path,{})).status).toBe(401);
 fixture.session.mockResolvedValue({userId:user});fixture.change.mockResolvedValue({revision:1});const raw={feature:'comments',scope:'GLOBAL',targetId:null};const response=await call('POST',path,raw);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(fixture.change).toHaveBeenCalledWith(user,raw,expect.any(String));expect(fixture.throttle).toHaveBeenCalledWith('mutation',user);expect(fixture.throttle).toHaveBeenCalledWith('feature-policy-write',user);
});
it('reads explicit operator targets and derives effective-user identity only from the session',async()=>{
 const tenant=randomUUID();fixture.inspect.mockResolvedValue({mode:'INHERIT',revision:0});expect((await call('GET',['admin','feature-policy'],undefined,true,'?feature=comments&scope=GLOBAL')).status).toBe(200);expect(fixture.inspect).toHaveBeenCalledWith(user,{feature:'comments',scope:'GLOBAL',targetId:null},expect.any(String));
 fixture.overview.mockResolvedValue({features:[]});expect((await call('GET',['organizations',tenant,'features'])).status).toBe(200);expect(fixture.overview).toHaveBeenCalledWith(user,tenant);expect(fixture.throttle).toHaveBeenCalledWith('feature-policy-effective',user);
});
