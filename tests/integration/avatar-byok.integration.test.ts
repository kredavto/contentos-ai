import {randomUUID,randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {beforeAll,describe,it,expect} from 'vitest';
import {BillingRepository,ProviderKeyRepository,AvatarRepository,ConsentRepository,MediaRepository,LedgerRepository} from '../../packages/db/src/index';
import {ProviderKeyService} from '../../packages/core/src/provider-keys';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import {isolatedTestDatabase} from '../helpers/isolated-database';
import {AvatarService,AvatarProcessor} from '../../packages/core/src/avatars';
import {ConsentService,consentPolicy} from '../../packages/core/src/consent';
import {MediaService} from '../../packages/core/src/media';
import {type AvatarProvider,type StorageProvider} from '../../packages/types/src/index';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('BYOK-bound avatar jobs',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=isolatedTestDatabase(url),repo=new AvatarRepository(database.db),ledger=new LedgerRepository(database.db);
  const tenantId=randomUUID(),userId=randomUUID(),viewerId=randomUUID(),workspaceId=randomUUID(),brandId=randomUUID(),correlationId=randomUUID();let assetId='';
  const storage:StorageProvider={get:async()=>{throw new Error('Unexpected fixture read');},put:async()=>{},delete:async()=>{},signedDownload:async()=> 'https://storage.example.test/fixture.jpg'};
  const consent=new ConsentService(new ConsentRepository(database.db));
  const vault=new CredentialVault(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1'),keys=new ProviderKeyService(new ProviderKeyRepository(database.db),vault);
  let creates=0,polls=0,deletes=0;
  const provider:AvatarProvider={create:async(_input,context)=>{creates++;return {provider:'heygen',internalId:context.internalId,externalId:`look-${context.internalId}`,metadata:{groupId:`group-${context.internalId}`}};},list:async()=>[],status:async()=>{polls++;return {status:'READY',previewUrl:null};},delete:async()=>{deletes++;}};
  const byok={vault,provider:(secret:string)=>{expect(secret).toMatch(/^fixture-/);return provider;}};
  const service=new AvatarService(repo,null,storage,true,byok),processor=new AvatarProcessor(database.db,null,storage,true,undefined,byok);
  async function key(){const current=(await keys.list(userId,tenantId,brandId))[0];return keys.save(userId,tenantId,brandId,{provider:'heygen',apiKey:`fixture-${randomUUID()}`,revision:current?.revision??null},correlationId);}
  async function queued(){const saved=await key(),{subject}=await person();const input={...request(subject),connection:{id:saved.id,revision:saved.revision}};const job=await service.create(userId,tenantId,brandId,input,correlationId);await due(job.id);return {saved,job,input};}
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
    const [plan]=await database.client`update plans set enabled=true where code='EXPERT' returning id`;const version=randomUUID();await database.client`insert into plan_versions(id,plan_id,version,amount_minor,ai_credits,video_seconds) values(${version},${plan!.id},1,10000,100,100)`;
    const billing=new BillingRepository(database.db),merchant={provider:'yookassa' as const,merchantId:'100500',test:true};const order=await billing.checkout(userId,tenantId,version,randomUUID(),{returnUrl:'https://example.test/billing',receipt:{customerEmail:'fixture@example.test',vatCode:11,subject:'service',mode:'full_payment'}},merchant,correlationId);await billing.settle(tenantId,order.id,{...merchant,externalId:randomUUID(),internalId:order.id,amountMinor:10000,currency:'RUB',status:'SUCCEEDED',paid:true});
    await ledger.adjust(tenantId,'AI_CREDITS',200,randomUUID(),correlationId);
    const photo=await sharp({create:{width:100,height:100,channels:3,background:'#aaddff'}}).png().toBuffer();
    assetId=(await new MediaService(new MediaRepository(database.db),storage).upload(userId,tenantId,brandId,{name:'Fixture.png',mimeType:'image/png',idempotencyKey:randomUUID()},photo,correlationId)).id;
  });

  it('creates, polls and deletes with the exact key without a shared provider connection',async()=>{
    const {job,input}=await queued();expect((await service.create(userId,tenantId,brandId,input,correlationId)).id).toBe(job.id);
    const before=creates;await processor.run(tenantId,job.id);expect(creates).toBe(before+1);expect((await row(job.id)).status).toBe('WAITING_EXTERNAL');
    await due(job.id);await processor.run(tenantId,job.id);expect((await row(job.id)).status).toBe('SUCCEEDED');expect(polls).toBeGreaterThan(0);
    const [avatar]=await database.client`select a.* from avatars a join avatar_looks l on l.avatar_id=a.id where l.job_id=${job.id}`;expect(avatar!.provider_key_id).toBe(input.connection.id);expect(avatar!.provider_key_revision).toBe(input.connection.revision);
    await expect(database.client`update avatars set provider_key_revision=provider_key_revision+1 where id=${avatar!.id}`).rejects.toThrow('immutable');
    await service.delete(userId,tenantId,brandId,avatar!.id,correlationId);await database.client`update avatars set delete_after=now()-interval '1 second' where id=${avatar!.id}`;expect(await service.cleanupOne()).toBe(true);expect(deletes).toBe(1);
  });
  it('releases an unsubmitted reservation after key revocation without calling the provider',async()=>{
    const {saved,job}=await queued(),before=creates;await keys.revoke(userId,tenantId,brandId,saved.id,{revision:saved.revision},correlationId);await processor.run(tenantId,job.id);expect(creates).toBe(before);expect((await row(job.id)).status).toBe('FAILED');
    expect((await database.client`select status from usage_reservations where id=${(await row(job.id)).reservation_id}`)[0]?.status).toBe('RELEASED');
  });
  it.each(['revoke','replace'] as const)('holds submitted work for reconciliation after key %s and never uses another account',async(change)=>{
    const {saved,job}=await queued();await processor.run(tenantId,job.id);const before=polls;
    if(change==='revoke')await keys.revoke(userId,tenantId,brandId,saved.id,{revision:saved.revision},correlationId);else await key();
    await due(job.id);await processor.run(tenantId,job.id);expect(polls).toBe(before);expect((await row(job.id)).status).toBe('RECONCILIATION');
    expect((await database.client`select status from usage_reservations where id=${(await row(job.id)).reservation_id}`)[0]?.status).toBe('HELD');await expect(service.resume(userId,tenantId,brandId,job.id,correlationId)).rejects.toThrow('CONFIGURATION_REQUIRED');
    const [look]=await database.client`select avatar_id from avatar_looks where job_id=${job.id}`;await service.delete(userId,tenantId,brandId,look!.avatar_id,correlationId);await database.client`update avatars set delete_after=now()-interval '1 second' where id=${look!.avatar_id}`;const deleted=deletes;await service.cleanupOne();expect(deletes).toBe(deleted);expect((await database.client`select status from avatars where id=${look!.avatar_id}`)[0]?.status).toBe('DELETE_PENDING');
  });
  it('does not switch a queued BYOK job to a configured shared provider when the vault is missing',async()=>{
    const {job}=await queued(),before=creates;await new AvatarProcessor(database.db,{name:'heygen',provider},storage,true).run(tenantId,job.id);expect(creates).toBe(before);expect((await row(job.id)).status).toBe('FAILED');
  });
});
