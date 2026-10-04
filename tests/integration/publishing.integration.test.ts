import {randomUUID,randomBytes} from 'node:crypto';
import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {createDatabase,PublishingRepository,CalendarRepository,SocialRepository} from '../../packages/db/src/index';
import {PublishingProcessor} from '../../packages/core/src/publishing';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import {SocialService} from '../../packages/core/src/social';
import {calendarCreateSchema,calendarUpdateSchema,DomainError,ProviderRequestError,type PublishingProvider,type SocialConnectionProvider} from '../../packages/types/src/index';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable approval publishing',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=createDatabase(url??'postgresql://localhost/unused_test'),tenantId=randomUUID(),brandId=randomUUID(),workspaceId=randomUUID(),owner=randomUUID(),editor=randomUUID(),correlation=randomUUID();
  let now=new Date('2030-01-01T00:00:00Z');const repo=new PublishingRepository(database.db,()=>now),calendar=new CalendarRepository(database.db),socialRepo=new SocialRepository(database.db);
  const vault=new CredentialVault(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1');
  const inspector:SocialConnectionProvider={inspect:async(_token,target,ctx)=>({name:'Fixture channel',username:'fixture',canPublish:true,reference:{provider:'telegram',internalId:ctx.internalId,externalId:target.startsWith('@')?'-1001234567890':target,metadata:{public:true,hasLinkedDiscussion:false}}})};
  const social=new SocialService(socialRepo,{name:'telegram',provider:inspector},vault);let connectionId='';let sends=0;
  const provider:PublishingProvider={publish:async(_input,ctx)=>{sends++;return {reference:{provider:'telegram',internalId:ctx.internalId,externalId:String(sends),metadata:{channelId:'-1001234567890'}},status:'PUBLISHED',url:null,publishedAt:now.toISOString()};}};
  const processor=new PublishingProcessor(repo,{name:'telegram',provider},{name:'telegram',provider:inspector},vault,null);
  const data=()=>calendarCreateSchema.parse({title:'Fixture publication',type:'POST',platform:'TELEGRAM',caption:'Одобренный текст',commentsEnabled:false,privacy:'PUBLIC',localDateTime:'2030-01-01T00:10',timeZone:'UTC',idempotencyKey:randomUUID()});
  async function planned(){now=new Date('2030-01-01T00:00:00Z');const original=data(),entry=await calendar.create(owner,tenantId,brandId,original,[],correlation);const {idempotencyKey:_key,...fields}=original;return {entry,fields,input:{calendarId:entry.id,revision:0,connectionId,idempotencyKey:randomUUID()}};}
  async function state(id:string){return (await repo.list(owner,tenantId,brandId)).find(row=>row.id===id)!;}
  beforeAll(async()=>{
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`publishing-${owner}@example.test`},'unusable','Owner',now()),(${editor},${`publishing-${editor}@example.test`},'unusable','Editor',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Publishing tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER'),(${tenantId},${editor},'EDITOR')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Fixture')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brandId},${tenantId},${workspaceId},'Fixture')`;
    const connected=await social.connect(owner,tenantId,brandId,{token:'123456:fixture_token_not_a_real_credential',target:'@fixture',idempotencyKey:randomUUID()},correlation);connectionId=connected.id;
  });
  afterAll(()=>database.close());
  it('requires manager approval, binds an immutable revision and publishes once when due',async()=>{
    const {entry,fields,input}=await planned();await expect(repo.approve(editor,tenantId,brandId,input,'telegram',[],correlation)).rejects.toThrow('NOT_AUTHORIZED');await expect(repo.approve(owner,tenantId,randomUUID(),input,'telegram',[],correlation)).rejects.toThrow('NOT_FOUND');
    const job=await repo.approve(owner,tenantId,brandId,input,'telegram',[],correlation);expect(await repo.approve(owner,tenantId,brandId,input,'telegram',[],correlation)).toEqual(job);expect(await repo.claim(tenantId,job.id)).toBeNull();
    await expect(calendar.update(owner,tenantId,brandId,entry.id,calendarUpdateSchema.parse({...fields,revision:0}),[],correlation)).rejects.toThrow('CONFLICT');await expect(calendar.cancel(owner,tenantId,brandId,entry.id,0,correlation)).rejects.toThrow('CONFLICT');
    await expect(database.client`update publishing_jobs set snapshot='{}'::jsonb where id=${job.id}`).rejects.toThrow('immutable');
    now=new Date('2030-01-01T00:11:00Z');expect((await repo.due()).some(row=>row.id===job.id)).toBe(true);await Promise.all([processor.run(tenantId,job.id),processor.run(tenantId,job.id)]);await processor.run(tenantId,job.id);expect(sends).toBe(1);expect((await state(job.id)).status).toBe('PUBLISHED');
    expect(await database.client`select id from publications where job_id=${job.id}`).toHaveLength(1);expect(JSON.stringify(await repo.list(editor,tenantId,brandId))).not.toContain('credential');
  });
  it('cancels before submission and permits a newly reviewed calendar revision',async()=>{
    const {entry,fields,input}=await planned(),job=await repo.approve(owner,tenantId,brandId,input,'telegram',[],correlation);await repo.cancel(owner,tenantId,brandId,job.id);await repo.cancel(owner,tenantId,brandId,job.id);
    await expect(repo.approve(owner,tenantId,brandId,{...input,idempotencyKey:randomUUID()},'telegram',[],correlation)).rejects.toThrow('CONFLICT');
    await calendar.update(owner,tenantId,brandId,entry.id,calendarUpdateSchema.parse({...fields,revision:0,caption:'Новая версия'}),[],correlation);const next=await repo.approve(owner,tenantId,brandId,{...input,revision:1,idempotencyKey:randomUUID()},'telegram',[],correlation);expect(next.id).not.toBe(job.id);await repo.cancel(owner,tenantId,brandId,next.id);
  });
  it('holds uncertain remote outcomes and never resends or permits cancellation after submission',async()=>{
    const {input}=await planned(),job=await repo.approve(owner,tenantId,brandId,input,'telegram',[],correlation);let attempts=0;
    const uncertain=new PublishingProcessor(repo,{name:'telegram',provider:{publish:async()=>{attempts++;throw new ProviderRequestError('RECONCILIATION_REQUIRED',409,false);}}},{name:'telegram',provider:inspector},vault,null);
    now=new Date('2030-01-01T00:11:00Z');await uncertain.run(tenantId,job.id);await uncertain.run(tenantId,job.id);expect(attempts).toBe(1);expect((await state(job.id)).status).toBe('RECONCILIATION');await expect(repo.cancel(owner,tenantId,brandId,job.id)).rejects.toThrow('CONFLICT');
  });
  it('recovers a crashed submission without replay and accepts its late acknowledgement',async()=>{
    const {input}=await planned(),created=await repo.approve(owner,tenantId,brandId,input,'telegram',[],correlation);now=new Date('2030-01-01T00:11:00Z');const job=(await repo.claim(tenantId,created.id))!;await repo.begin(job,[]);now=new Date('2030-01-01T00:15:00Z');expect(await repo.claim(tenantId,job.id)).toBeNull();expect((await state(job.id)).status).toBe('RECONCILIATION');
    await repo.complete(job,{reference:{provider:'telegram',internalId:job.id,externalId:'late',metadata:{}},status:'PUBLISHED',url:null,publishedAt:now.toISOString()});expect((await state(job.id)).status).toBe('PUBLISHED');
  });
  it('rechecks authorization before remote work and distinguishes definite provider rejection',async()=>{
    const {input}=await planned(),created=await repo.approve(owner,tenantId,brandId,input,'telegram',[],correlation);now=new Date('2030-01-01T00:11:00Z');let attempts=0;
    const rejected=new PublishingProcessor(repo,{name:'telegram',provider:{publish:async()=>{attempts++;throw new ProviderRequestError('PROVIDER_REJECTED',502,true);}}},{name:'telegram',provider:inspector},vault,null);await rejected.run(tenantId,created.id);expect(attempts).toBe(1);expect((await state(created.id)).status).toBe('FAILED');
    const next=await planned(),job=await repo.approve(owner,tenantId,brandId,next.input,'telegram',[],correlation);await database.client`update organization_members set role='VIEWER' where tenant_id=${tenantId} and user_id=${owner}`;now=new Date('2030-01-01T00:11:00Z');const count=sends;await processor.run(tenantId,job.id);expect(sends).toBe(count);expect((await state(job.id)).status).toBe('FAILED');await database.client`update organization_members set role='OWNER' where tenant_id=${tenantId} and user_id=${owner}`;
  });
  it('backs off safe preparation failures and fences an expired preparation lease',async()=>{
    const {input}=await planned(),created=await repo.approve(owner,tenantId,brandId,input,'telegram',[],correlation);let inspections=0;
    const flaky:SocialConnectionProvider={inspect:async(...args)=>{if(++inspections===1)throw new DomainError('PROVIDER_UNAVAILABLE');return inspector.inspect(...args);}};
    const retrying=new PublishingProcessor(repo,{name:'telegram',provider},{name:'telegram',provider:flaky},vault,null);
    now=new Date('2030-01-01T00:11:00Z');const before=sends;await retrying.run(tenantId,created.id);expect((await state(created.id)).status).toBe('SCHEDULED');await retrying.run(tenantId,created.id);expect(inspections).toBe(1);expect(sends).toBe(before);
    now=new Date('2030-01-01T00:11:11Z');await retrying.run(tenantId,created.id);expect((await state(created.id)).status).toBe('PUBLISHED');expect(sends).toBe(before+1);
    const next=await planned(),second=await repo.approve(owner,tenantId,brandId,next.input,'telegram',[],correlation);now=new Date('2030-01-01T00:11:00Z');const old=(await repo.claim(tenantId,second.id))!;now=new Date('2030-01-01T00:15:00Z');const replacement=(await repo.claim(tenantId,second.id))!;expect(replacement.leaseToken).not.toBe(old.leaseToken);await expect(repo.begin(old,[])).rejects.toThrow('CONFLICT');await repo.cancel(owner,tenantId,brandId,second.id);
  });
  it('disconnect cancels a claimed preparation and fences its send marker',async()=>{
    const {input}=await planned(),created=await repo.approve(owner,tenantId,brandId,input,'telegram',[],correlation);now=new Date('2030-01-01T00:11:00Z');const job=(await repo.claim(tenantId,created.id))!;
    const channel=await socialRepo.managed(owner,tenantId,brandId,connectionId);await social.disconnect(owner,tenantId,brandId,connectionId,{revision:channel.revision},correlation);
    await expect(repo.begin(job,[])).rejects.toThrow('CONFLICT');expect((await state(job.id)).status).toBe('CANCELLED');
  });
});
