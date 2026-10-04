import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createDatabase,AvatarRepository,ConsentRepository,MediaRepository,LedgerRepository,VoiceRepository} from '../../packages/db/src/index';
import {VoiceService} from '../../packages/core/src/voices';
import {AvatarService,AvatarProcessor,avatarConsentPolicies} from '../../packages/core/src/avatars';
import {ConsentService,consentPolicy} from '../../packages/core/src/consent';
import {MediaService} from '../../packages/core/src/media';
import {MockAvatarProvider} from '../../packages/providers/src/avatar';
import {DomainError,ProviderRequestError,type AvatarProvider,type StorageProvider} from '../../packages/types/src/index';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('consent-bound avatar jobs',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=createDatabase(url??'postgresql://localhost/unused_test'),repo=new AvatarRepository(database.db),ledger=new LedgerRepository(database.db);
  const tenantId=randomUUID(),userId=randomUUID(),viewerId=randomUUID(),workspaceId=randomUUID(),brandId=randomUUID(),correlationId=randomUUID();let assetId='';
  const storage:StorageProvider={get:async()=>{throw new Error('Unexpected fixture read');},put:async()=>{},delete:async()=>{},signedDownload:async()=> 'https://storage.example.test/fixture.jpg'};
  const consent=new ConsentService(new ConsentRepository(database.db));
  const connection={provider:new MockAvatarProvider('test'),name:`fixture-${tenantId}`};
  // Isolated provider namespace keeps deletion workers/tests tenant-independent.
  const provider:AvatarProvider={...connection.provider,create:async(input,context)=>({...await connection.provider.create(input,context),provider:connection.name}),list:async()=>[],status:async()=>({status:'READY',previewUrl:null}),delete:async()=>{}};
  const configured={provider,name:connection.name};
  const service=new AvatarService(repo,configured,storage,true),processor=new AvatarProcessor(database.db,configured,storage,true);
  async function person(accept=true){
    const subject=(await consent.createSubject(userId,tenantId,brandId,{name:'Fictional fixture',type:'PERSON'},correlationId)).id;
    const records:string[]=[];
    if(accept)for(const type of ['OWN_LIKENESS','CROSS_BORDER_PROCESSING'] as const){const policy=consentPolicy(type);records.push((await consent.accept(userId,tenantId,brandId,{subjectId:subject,type:policy.type,version:policy.version,textHash:policy.textHash,accepted:true,idempotencyKey:randomUUID()},{ip:'127.0.0.1',userAgent:'fixture'},correlationId)).id);}
    return {subject,records};
  }
  const request=(subjectId:string)=>({name:'Fictional look',sourceAssetId:assetId,subjectId,likenessType:'OWN_LIKENESS',idempotencyKey:randomUUID()});
  const due=async(id:string)=>{await database.client`update jobs set next_attempt_at=now()-interval '1 second' where id=${id}`;};
  const row=async(id:string)=>(await database.client`select * from jobs where id=${id}`)[0]!;
  beforeAll(async()=>{
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${userId},${`avatar-${userId}@example.test`},'test-unusable','Owner',now()),(${viewerId},${`avatar-${viewerId}@example.test`},'test-unusable','Viewer',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Avatar tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${userId},'OWNER'),(${tenantId},${viewerId},'VIEWER')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Fixture')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brandId},${tenantId},${workspaceId},'Fixture')`;
    await ledger.adjust(tenantId,'AI_CREDITS',200,randomUUID(),correlationId);
    const photo=await sharp({create:{width:100,height:100,channels:3,background:'#aaddff'}}).png().toBuffer();
    assetId=(await new MediaService(new MediaRepository(database.db),storage).upload(userId,tenantId,brandId,{name:'Fixture.png',mimeType:'image/png',idempotencyKey:randomUUID()},photo,correlationId)).id;
  });
  afterAll(()=>database.close());
  it('rejects missing consent, cross-tenant access and viewer mutations before reserving',async()=>{
    const {subject}=await person(false);const input=request(subject);
    await expect(service.create(userId,tenantId,brandId,input,correlationId)).rejects.toThrow('CONSENT_REQUIRED');
    await expect(service.create(viewerId,tenantId,brandId,input,correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.create(userId,randomUUID(),brandId,input,correlationId)).rejects.toThrow('NOT_FOUND');
    expect(await database.client`select id from jobs where tenant_id=${tenantId}`).toHaveLength(0);
  });
  it('deduplicates intent, captures once on readiness, adds a look and deletes the group',async()=>{
    const {subject}=await person();const input=request(subject);
    const first=await service.create(userId,tenantId,brandId,input,correlationId);
    expect((await service.create(userId,tenantId,brandId,input,correlationId)).id).toBe(first.id);
    await expect(service.create(userId,tenantId,brandId,{...input,name:'Changed'},correlationId)).rejects.toThrow('CONFLICT');
    await processor.run(tenantId,first.id);expect((await row(first.id)).status).toBe('WAITING_EXTERNAL');
    await due(first.id);await processor.run(tenantId,first.id);await processor.run(tenantId,first.id);
    expect((await row(first.id)).status).toBe('SUCCEEDED');
    const look=(await service.overview(userId,tenantId,brandId)).looks.find(look=>look.jobId===first.id)!;
    expect(look.consentValid).toBe(true);expect(JSON.stringify(look)).not.toContain('externalId');
    const second=await service.create(userId,tenantId,brandId,{...request(subject),avatarId:look.avatarId},correlationId);
    await processor.run(tenantId,second.id);await due(second.id);await processor.run(tenantId,second.id);
    expect(await database.client`select id from usage_ledger where tenant_id=${tenantId} and type='CAPTURE'`).toHaveLength(2);
    await service.delete(userId,tenantId,brandId,look.avatarId,correlationId);
    // Make the queued deadline due in the database clock, independent of host/container clock skew.
    await database.client`update avatars set delete_after=now()-interval '1 second' where id=${look.avatarId}`;expect(await service.cleanupOne()).toBe(true);
    expect((await service.overview(userId,tenantId,brandId)).looks).toHaveLength(0);
  });
  it('does not reactivate queued work when withdrawn consent is granted again',async()=>{
    const {subject,records}=await person();const job=await service.create(userId,tenantId,brandId,request(subject),correlationId);
    await consent.revoke(userId,tenantId,brandId,records[0]!,correlationId);
    const policy=consentPolicy('OWN_LIKENESS');await consent.accept(userId,tenantId,brandId,{subjectId:subject,type:policy.type,version:policy.version,textHash:policy.textHash,accepted:true,idempotencyKey:randomUUID()},{ip:'127.0.0.1',userAgent:'fixture'},correlationId);
    await processor.run(tenantId,job.id);expect((await row(job.id)).status).toBe('FAILED');expect((await row(job.id)).error_code).toBe('CONSENT_REQUIRED');
  });
  it('replays an uncertain submission with the original key and stops beyond the replay window',async()=>{
    const {subject}=await person();const input=request(subject);const job=await service.create(userId,tenantId,brandId,input,correlationId);const keys:string[]=[];
    const uncertain={...provider,create:async(_input:Parameters<AvatarProvider['create']>[0],context:Parameters<AvatarProvider['create']>[1])=>{keys.push(context.idempotencyKey);throw new DomainError('PROVIDER_UNAVAILABLE');}};
    const failing=new AvatarProcessor(database.db,{provider:uncertain,name:connection.name},storage,true);
    await failing.run(tenantId,job.id);await due(job.id);await failing.run(tenantId,job.id);expect(keys).toEqual([input.idempotencyKey,input.idempotencyKey]);
    await database.client`update avatar_looks set first_submitted_at=now()-interval '24 hours' where job_id=${job.id}`;
    await due(job.id);await failing.run(tenantId,job.id);expect(keys).toHaveLength(2);expect((await row(job.id)).status).toBe('RECONCILIATION');
    await expect(service.resume(userId,tenantId,brandId,job.id,correlationId)).rejects.toThrow('RECONCILIATION_REQUIRED');
    const [reservation]=await database.client`select status from usage_reservations where id=${(await row(job.id)).reservation_id}`;expect(reservation?.status).toBe('HELD');
  });
  it('refunds definitive rejection and retains late references for canceled work',async()=>{
    const {subject}=await person();const rejected=await service.create(userId,tenantId,brandId,request(subject),correlationId);
    const failing=new AvatarProcessor(database.db,{name:connection.name,provider:{...provider,create:async()=>{throw new ProviderRequestError('PROVIDER_REJECTED',502,true);}}},storage,true);
    await failing.run(tenantId,rejected.id);expect((await row(rejected.id)).status).toBe('FAILED');
    const queued=await service.create(userId,tenantId,brandId,request(subject),correlationId);const claimed=(await repo.claim(tenantId,queued.id))!;const data=await repo.prepare(claimed,avatarConsentPolicies(),true);
    await service.delete(userId,tenantId,brandId,data.avatar.id,correlationId);
    await database.client`update avatars set delete_after=now()-interval '1 second' where id=${data.avatar.id}`;
    expect(await repo.claimDeletion(connection.name)).toBeNull();
    await repo.submitted(claimed,await provider.create({photoUrl:'https://storage.example.test/photo.jpg',name:'Fixture'},{tenantId,internalId:claimed.id,idempotencyKey:claimed.idempotencyKey,correlationId,signal:new AbortController().signal}));
    await expect(repo.complete(claimed,avatarConsentPolicies())).rejects.toThrow('CONFLICT');
    expect(await service.cleanupOne()).toBe(true);
  });
  it('does not exhaust submission retries during normal long-running polling',async()=>{
    const {subject}=await person();const job=await service.create(userId,tenantId,brandId,request(subject),correlationId);
    const pending=new AvatarProcessor(database.db,{name:connection.name,provider:{...provider,status:async()=>({status:'PROCESSING',previewUrl:null})}},storage,true);
    for(let i=0;i<5;i++){await due(job.id);await pending.run(tenantId,job.id);}
    expect((await row(job.id)).status).toBe('WAITING_EXTERNAL');await due(job.id);await processor.run(tenantId,job.id);expect((await row(job.id)).status).toBe('SUCCEEDED');
  });
  it('keeps public voice IDs stable and restricts assignment by brand, tenant and role',async()=>{
    const catalog={name:connection.name,provider:{listPublicVoicePage:async()=>({voices:[{name:'Public fixture',language:'Russian',previewUrl:null,reference:{provider:connection.name,externalId:'public-test',internalId:randomUUID(),metadata:{public:true}}}],nextCursor:null})}};
    const voices=new VoiceService(new VoiceRepository(database.db),catalog);
    await expect(voices.refresh(viewerId,tenantId,brandId,{},correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    await voices.refresh(userId,tenantId,brandId,{},correlationId);const first=(await voices.overview(userId,tenantId,brandId)).voices[0]!;
    await voices.refresh(userId,tenantId,brandId,{},correlationId);expect((await voices.overview(userId,tenantId,brandId)).voices[0]?.id).toBe(first.id);
    expect(JSON.stringify(first)).not.toContain('externalId');
    const {subject}=await person();const job=await service.create(userId,tenantId,brandId,request(subject),correlationId);
    const look=(await service.overview(userId,tenantId,brandId)).looks.find(look=>look.jobId===job.id)!;
    await expect(voices.select(viewerId,tenantId,brandId,look.avatarId,{voiceId:first.id},correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(voices.select(userId,tenantId,randomUUID(),look.avatarId,{voiceId:first.id},correlationId)).rejects.toThrow('NOT_FOUND');
    await voices.select(userId,tenantId,brandId,look.avatarId,{voiceId:first.id},correlationId);
    expect((await service.overview(userId,tenantId,brandId)).looks.find(item=>item.id===look.id)?.voiceId).toBe(first.id);
    const unsafe=new VoiceService(new VoiceRepository(database.db),{name:connection.name,provider:{listPublicVoicePage:async()=>({voices:[{name:'Private',language:null,previewUrl:null,reference:{provider:connection.name,externalId:'private',internalId:randomUUID(),metadata:{public:false}}}],nextCursor:null})}});
    await expect(unsafe.refresh(userId,tenantId,brandId,{},correlationId)).rejects.toThrow('PROVIDER_REJECTED');
  });
});
