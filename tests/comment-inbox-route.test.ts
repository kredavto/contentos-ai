import {randomUUID} from 'node:crypto';
import {beforeEach,expect,it,vi} from 'vitest';
import {DomainError} from '../packages/types/src/index';
const fixture=vi.hoisted(()=>({approvalStatus:vi.fn(),approve:vi.fn(),revokeApproval:vi.fn(),generationStatus:vi.fn(),history:vi.fn(),save:vi.fn(),session:vi.fn(),throttle:vi.fn(),list:vi.fn(),triage:vi.fn(),latest:vi.fn(),request:vi.fn(),resume:vi.fn(),cancel:vi.fn()}));
vi.mock('../apps/web/node_modules/next/headers.js',()=>({cookies:async()=>({get:()=>({value:'fixture-session'})})}));
vi.mock('../apps/web/src/server/services',()=>({sessionCookie:'session',services:()=>({
 commentReplies:{approvalStatus:fixture.approvalStatus,approve:fixture.approve,revokeApproval:fixture.revokeApproval,generationStatus:fixture.generationStatus,history:fixture.history,save:fixture.save},auth:{session:fixture.session,throttle:fixture.throttle},comments:{list:fixture.list,triage:fixture.triage},commentImports:{latest:fixture.latest,request:fixture.request,resume:fixture.resume,cancel:fixture.cancel},env:{APP_URL:'https://contentos.example',NODE_ENV:'production'},
})}));
vi.mock('../apps/web/src/server/error-reporting',()=>({errorReporter:()=>({capture:vi.fn(),flush:async()=>true})}));
import {GET,POST,PATCH} from '../apps/web/src/app/api/[...path]/route';
const origin='https://contentos.example',user=randomUUID(),tenant=randomUUID(),brand=randomUUID(),publication=randomUUID(),id=randomUUID();
const base=`v1/organizations/${tenant}/brands/${brand}/publications/${publication}/comments`;
async function call(path=base,method:'GET'|'POST'|'PATCH'='GET',body?:unknown,withOrigin=true){
 const request=new Request(`${origin}/api/${path}`,{method,headers:{'content-type':'application/json',...(withOrigin?{origin}:{})},...(body===undefined||method==='GET'?{}:{body:JSON.stringify(body)})});
 return ({GET,POST,PATCH}[method])(request,{params:Promise.resolve({path:path.split('?')[0]!.split('/')})});
}
beforeEach(()=>{vi.resetAllMocks();fixture.session.mockResolvedValue({userId:user});fixture.list.mockResolvedValue({items:[],next:null});fixture.latest.mockResolvedValue({job:null,configuration:{ready:false,status:'CONFIGURATION_REQUIRED'}});});
it('returns sync state with an empty inbox and passes scoped pagination to the service',async()=>{
 const parent=randomUUID(),response=await call(`${base}?parentId=${parent}&status=NEW`);
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
 const body=await response.json();expect(body).toMatchObject({data:{items:[],next:null,sync:{job:null,configuration:{ready:false}}},error:null});
 expect(body.meta.requestId).toBe(response.headers.get('x-request-id'));
 expect(fixture.list).toHaveBeenCalledWith(user,tenant,brand,publication,{parentId:parent,status:'NEW'});
 expect(fixture.latest).toHaveBeenCalledWith(user,tenant,brand,publication);
});
it('requires a session for reads and same-origin authentication for every mutation',async()=>{
 fixture.session.mockResolvedValue(null);expect((await call()).status).toBe(401);expect(fixture.list).not.toHaveBeenCalled();
 fixture.session.mockResolvedValue({userId:user});
 for(const [suffix,method] of [[`/${id}`,'PATCH'],['/imports','POST'],[`/imports/${id}/resume`,'POST'],[`/imports/${id}/cancel`,'POST']] as const)expect((await call(base+suffix,method,{},false)).status).toBe(403);
 for(const handler of [fixture.triage,fixture.request,fixture.resume,fixture.cancel])expect(handler).not.toHaveBeenCalled();
});
it('dispatches import commands with throttling, optimistic revisions and correlation',async()=>{
 fixture.request.mockResolvedValue({id,status:'QUEUED'});fixture.resume.mockResolvedValue({id,status:'QUEUED'});fixture.cancel.mockResolvedValue({id,status:'CANCELLED'});
 const input={idempotencyKey:randomUUID()};expect((await call(base+'/imports','POST',input)).status).toBe(202);
 expect(fixture.request).toHaveBeenCalledWith(user,tenant,brand,publication,input,expect.any(String));
 expect(fixture.throttle).toHaveBeenCalledWith('mutation',user);expect(fixture.throttle).toHaveBeenCalledWith('comment-import',user);
 expect((await call(`${base}/imports/${id}/resume`,'POST',{revision:2})).status).toBe(202);
 expect(fixture.resume).toHaveBeenCalledWith(user,tenant,brand,publication,id,{revision:2});
 expect((await call(`${base}/imports/${id}/cancel`,'POST',{revision:3})).status).toBe(200);
 expect(fixture.cancel).toHaveBeenCalledWith(user,tenant,brand,publication,id,{revision:3});
});
it('keeps manual triage separate from imports and returns safe service conflicts',async()=>{
 const input={revision:1,contentRevision:2,status:'NEEDS_HUMAN'};fixture.triage.mockResolvedValue({id,...input});
 expect((await call(`${base}/${id}`,'PATCH',input)).status).toBe(200);
 expect(fixture.triage).toHaveBeenCalledWith(user,tenant,brand,publication,id,input,expect.any(String));
 fixture.triage.mockRejectedValue(new DomainError('CONFLICT',409));const response=await call(`${base}/${id}`,'PATCH',input);
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({data:null,error:{code:'CONFLICT'}});
 expect(fixture.request).not.toHaveBeenCalled();
});
it('exposes polling without mutation and rejects unsupported suffixes or methods',async()=>{
 expect((await call(base+'/imports')).status).toBe(200);expect(fixture.latest).toHaveBeenCalledOnce();
 for(const [suffix,method] of [['/imports/extra','GET'],['/imports','PATCH'],[`/imports/${id}/unknown`,'POST'],[`/${id}/extra`,'PATCH']] as const)expect((await call(base+suffix,method,{})).status).toBe(404);
 for(const handler of [fixture.triage,fixture.request,fixture.resume,fixture.cancel])expect(handler).not.toHaveBeenCalled();
});

it('scopes draft history and versioned saves and rejects cross-origin writes',async()=>{
 fixture.history.mockResolvedValue({draft:null,items:[],next:null});fixture.save.mockResolvedValue({id,revision:0,currentVersion:1});
 expect((await call(`${base}/${id}/draft?beforeVersion=4`)).status).toBe(200);
 expect(fixture.history).toHaveBeenCalledWith(user,tenant,brand,publication,id,{beforeVersion:'4'});
 const input={revision:null,contentRevision:0,reviewRevision:0,reply:'Draft only'};
 expect((await call(`${base}/${id}/draft`,'POST',input,false)).status).toBe(403);expect(fixture.save).not.toHaveBeenCalled();
 expect((await call(`${base}/${id}/draft`,'POST',input)).status).toBe(201);
 expect(fixture.save).toHaveBeenCalledWith(user,tenant,brand,publication,id,input,expect.any(String));
 fixture.save.mockRejectedValue(new DomainError('CONFLICT',409));expect((await call(`${base}/${id}/draft`,'POST',input)).status).toBe(409);
});

it('reads comment-scoped generation status without exposing a mutation endpoint',async()=>{
 fixture.generationStatus.mockResolvedValue({job:{id,status:'SUCCEEDED',result:{version:1}}});
 const response=await call(`${base}/${id}/draft/generation`);expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
 expect(fixture.generationStatus).toHaveBeenCalledWith(user,tenant,brand,publication,id);
 expect((await call(`${base}/${id}/draft/generation`,'POST',{})).status).toBe(404);
 fixture.session.mockResolvedValue(null);expect((await call(`${base}/${id}/draft/generation`)).status).toBe(401);
});

it('scopes approval and revocation with authenticated Origin checks',async()=>{
 fixture.approvalStatus.mockResolvedValue(null);fixture.approve.mockResolvedValue({id,version:1});fixture.revokeApproval.mockResolvedValue({id,status:'REVOKED'});
 const endpoint=`${base}/${id}/draft/approval`,input={version:1,revision:0,acknowledgeRisks:true,idempotencyKey:randomUUID()};
 expect((await call(endpoint)).status).toBe(200);expect(fixture.approvalStatus).toHaveBeenCalledWith(user,tenant,brand,publication,id);
 expect((await call(endpoint,'POST',input,false)).status).toBe(403);expect(fixture.approve).not.toHaveBeenCalled();
 expect((await call(endpoint,'POST',input)).status).toBe(201);expect(fixture.approve).toHaveBeenCalledWith(user,tenant,brand,publication,id,input,expect.any(String));
 expect((await call(`${endpoint}/${id}/revoke`,'POST',{},false)).status).toBe(403);expect(fixture.revokeApproval).not.toHaveBeenCalled();
 expect((await call(`${endpoint}/${id}/revoke`,'POST',{})).status).toBe(200);expect(fixture.revokeApproval).toHaveBeenCalledWith(user,tenant,brand,publication,id,id,expect.any(String));
});
