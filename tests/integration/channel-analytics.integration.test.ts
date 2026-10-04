import {randomUUID,randomBytes} from 'node:crypto';
import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {createDatabase,ChannelAnalyticsRepository,SocialRepository} from '../../packages/db/src/index';
import {ChannelAnalyticsProcessor} from '../../packages/core/src/channel-analytics';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import {SocialService} from '../../packages/core/src/social';
import {DomainError,type ChannelAnalyticsProvider,type SocialConnectionProvider} from '../../packages/types/src/index';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable channel analytics',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=createDatabase(url??'postgresql://localhost/unused_test'),tenantId=randomUUID(),brandId=randomUUID(),workspaceId=randomUUID(),owner=randomUUID(),editor=randomUUID(),correlation=randomUUID();
  let now=new Date('2031-01-01T00:00:00Z'),counter=0,calls=0;
  const repo=new ChannelAnalyticsRepository(database.db,()=>now),socialRepo=new SocialRepository(database.db),vault=new CredentialVault(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1');
  const inspector:SocialConnectionProvider={inspect:async(_token,target,ctx)=>({name:'Analytics fixture',username:null,canPublish:true,reference:{provider:'telegram',internalId:ctx.internalId,externalId:target,metadata:{public:false}}})};
  const social=new SocialService(socialRepo,{name:'telegram',provider:inspector},vault),configured={name:'telegram',source:'API' as const};
  const provider:ChannelAnalyticsProvider={fetchChannel:async()=>{calls++;return {memberCount:0,rawResult:0,observedAt:now.toISOString()};}};
  const processor=new ChannelAnalyticsProcessor(repo,{...configured,provider},vault);
  const token='123456:fixture_token_not_a_real_credential';
  const advance=(ms:number)=>{now=new Date(now.getTime()+ms);};
  async function connect(){return (await social.connect(owner,tenantId,brandId,{token,target:String(-10000000-++counter),idempotencyKey:randomUUID()},correlation)).id;}
  const request=(id:string,key=randomUUID())=>repo.request(owner,tenantId,brandId,id,key,configured,correlation);
  async function state(id:string){return (await repo.overview(owner,tenantId,brandId)).find(row=>row.id===id)!;}
  beforeAll(async()=>{
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`analytics-${owner}@example.test`},'unusable','Owner',now()),(${editor},${`analytics-${editor}@example.test`},'unusable','Editor',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Analytics tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER'),(${tenantId},${editor},'EDITOR')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Fixture')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brandId},${tenantId},${workspaceId},'Fixture')`;
  });
  afterAll(()=>database.close());
  it('authorizes, deduplicates and records zero exactly once with private immutable evidence',async()=>{
    const id=await connect(),key=randomUUID();await expect(repo.request(editor,tenantId,brandId,id,key,configured,correlation)).rejects.toThrow('NOT_AUTHORIZED');
    const job=await request(id,key);expect(await request(id,key)).toEqual(job);await expect(request(id)).rejects.toThrow('CONFLICT');expect((await repo.due()).some(row=>row.id===job.id)).toBe(true);
    const before=calls;await Promise.all([processor.run(tenantId,job.id),processor.run(tenantId,job.id)]);await processor.run(tenantId,job.id);expect(calls).toBe(before+1);
    expect((await state(id)).job?.status).toBe('SUCCEEDED');expect((await state(id)).latest?.memberCount).toBe(0);const history=await repo.history(editor,tenantId,brandId,id);expect(history).toHaveLength(1);
    const [evidence]=await database.client`select payload from channel_metric_evidence where metric_id=${history[0]!.id}`;expect(evidence!.payload).toEqual({result:0});
    const display=JSON.stringify(await repo.overview(editor,tenantId,brandId));for(const secret of [token,'credential','rawResult','leaseToken','reference'])expect(display).not.toContain(secret);
    await expect(database.client`update channel_metrics set member_count=4 where id=${history[0]!.id}`).rejects.toThrow();await expect(database.client`delete from channel_metric_evidence where metric_id=${history[0]!.id}`).rejects.toThrow();await expect(database.client`update channel_analytics_jobs set credential_version=2 where id=${job.id}`).rejects.toThrow('immutable');
    await expect(request(id)).rejects.toThrow('RATE_LIMITED');advance(61000);const next=await request(id);await processor.run(tenantId,next.id);expect(await repo.history(owner,tenantId,brandId,id)).toHaveLength(2);
  });
  it('backs off transient reads, bounds attempts and never substitutes failed reads with zero',async()=>{
    const id=await connect(),job=await request(id);let attempts=0;const failing=new ChannelAnalyticsProcessor(repo,{...configured,provider:{fetchChannel:async()=>{attempts++;throw new DomainError('PROVIDER_UNAVAILABLE');}}},vault);
    await failing.run(tenantId,job.id);expect((await state(id)).job?.status).toBe('QUEUED');await failing.run(tenantId,job.id);expect(attempts).toBe(1);advance(11000);await failing.run(tenantId,job.id);advance(21000);await failing.run(tenantId,job.id);await failing.run(tenantId,job.id);expect(attempts).toBe(3);expect((await state(id)).job?.status).toBe('FAILED');expect((await state(id)).latest).toBeNull();
  });
  it('recovers an expired lease and fences all stale writes',async()=>{
    const id=await connect(),created=await request(id),old=(await repo.claim(tenantId,created.id))!;advance(61000);const current=(await repo.claim(tenantId,created.id))!;expect(current.leaseToken).not.toBe(old.leaseToken);
    await expect(repo.complete(old,{memberCount:3,rawResult:3,observedAt:now.toISOString()})).rejects.toThrow('CONFLICT');await repo.fail(old,'PROVIDER_UNAVAILABLE');expect((await state(id)).job?.status).toBe('RUNNING');
    await repo.complete(current,{memberCount:3,rawResult:3,observedAt:now.toISOString()});expect((await state(id)).latest?.memberCount).toBe(3);
  });
  it('cancels in-flight reads on disconnect and discards their late responses',async()=>{
    const id=await connect(),job=await request(id);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const delayed=new ChannelAnalyticsProcessor(repo,{...configured,provider:{fetchChannel:async()=>{entered();await gate;return {memberCount:5,rawResult:5,observedAt:now.toISOString()};}}},vault);
    const running=delayed.run(tenantId,job.id);await started;const connection=await socialRepo.managed(owner,tenantId,brandId,id);await social.disconnect(owner,tenantId,brandId,id,{revision:connection.revision},correlation);release();await running;
    expect((await state(id)).job?.status).toBe('CANCELLED');expect(await repo.history(owner,tenantId,brandId,id)).toHaveLength(0);await expect(request(id)).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');
  });
  it('fences replaced credentials and rechecks the requesting role during execution',async()=>{
    const id=await connect(),job=await request(id),claimed=(await repo.claim(tenantId,job.id))!;const channel=await socialRepo.managed(owner,tenantId,brandId,id);
    await social.reconnect(owner,tenantId,brandId,id,{revision:channel.revision,token:'123456:replacement_fixture_not_a_credential'},correlation);await expect(repo.complete(claimed,{memberCount:9,rawResult:9,observedAt:now.toISOString()})).rejects.toThrow('CONFLICT');expect((await state(id)).job?.status).toBe('CANCELLED');
    advance(61000);const next=await request(id),before=calls;await database.client`update organization_members set role='VIEWER' where tenant_id=${tenantId} and user_id=${owner}`;
    try{await processor.run(tenantId,next.id);expect(calls).toBe(before);expect((await state(id)).job?.status).toBe('FAILED');}finally{await database.client`update organization_members set role='OWNER' where tenant_id=${tenantId} and user_id=${owner}`;}
  });
  it('rechecks authorization at completion and rejects invalid provider observations',async()=>{
    const id=await connect(),created=await request(id),job=(await repo.claim(tenantId,created.id))!;await repo.prepare(job);
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenantId} and user_id=${owner}`;
    try{await expect(repo.complete(job,{memberCount:1,rawResult:1,observedAt:now.toISOString()})).rejects.toThrow('NOT_AUTHORIZED');}finally{await database.client`update organization_members set role='OWNER' where tenant_id=${tenantId} and user_id=${owner}`;}
    for(const value of [{memberCount:1,rawResult:2,observedAt:now.toISOString()},{memberCount:1,rawResult:1,observedAt:new Date(now.getTime()+60000).toISOString()},{memberCount:1,rawResult:1,observedAt:new Date(now.getTime()-1000).toISOString()}])await expect(repo.complete(job,value)).rejects.toThrow('PROVIDER_REJECTED');
    await repo.fail(job,'PROVIDER_REJECTED');expect((await state(id)).latest).toBeNull();
  });
  it('isolates real organizations and brands, including database foreign keys',async()=>{
    const id=await connect(),otherTenant=randomUUID(),otherBrand=randomUUID(),otherWorkspace=randomUUID(),sibling=randomUUID();
    await database.client`insert into organizations(id,name) values(${otherTenant},'Other tenant')`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${otherTenant},${owner},'OWNER')`;await database.client`insert into workspaces(id,tenant_id,name) values(${otherWorkspace},${otherTenant},'Other workspace')`;await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${otherBrand},${otherTenant},${otherWorkspace},'Other brand'),(${sibling},${tenantId},${workspaceId},'Sibling')`;
    for(const [tenant,brand] of [[otherTenant,otherBrand],[tenantId,sibling]] as const){expect(await repo.overview(owner,tenant,brand)).toEqual([]);await expect(repo.history(owner,tenant,brand,id)).rejects.toThrow('NOT_FOUND');await expect(repo.request(owner,tenant,brand,id,randomUUID(),configured,correlation)).rejects.toThrow('NOT_FOUND');}
    await expect(repo.overview(randomUUID(),tenantId,brandId)).rejects.toThrow('NOT_FOUND');const job=await request(id);
    await expect(database.client`insert into channel_metrics(tenant_id,connection_id,job_id,provider,source,member_count,observed_at) values(${otherTenant},${id},${job.id},'telegram','API',0,now())`).rejects.toThrow();
    await processor.run(tenantId,job.id);
  });
  it('fails closed when runtime configuration is missing',async()=>{
    const id=await connect(),job=await request(id);await new ChannelAnalyticsProcessor(repo,null,vault).run(tenantId,job.id);expect((await state(id)).job).toMatchObject({status:'FAILED',errorCode:'CONFIGURATION_REQUIRED'});expect((await state(id)).latest).toBeNull();
  });
});
