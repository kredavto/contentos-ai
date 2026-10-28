import {randomUUID,randomBytes} from 'node:crypto';
import sharp from 'sharp';
import {beforeAll,describe,it,expect} from 'vitest';
import {BillingRepository,ProviderKeyRepository,VideoRepository,VoiceRepository,AvatarRepository,ConsentRepository,MediaRepository,LedgerRepository} from '../../packages/db/src/index';
import {VideoService,VideoProcessor} from '../../packages/core/src/videos';
import {ProviderKeyService} from '../../packages/core/src/provider-keys';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import type {HeyGenCircuitScope} from '../../packages/providers/src/index';
import {isolatedTestDatabase} from '../helpers/isolated-database';
import {AvatarService,AvatarProcessor} from '../../packages/core/src/avatars';
import {ConsentService,consentPolicy} from '../../packages/core/src/consent';
import {MediaService} from '../../packages/core/src/media';
import {type VideoProvider,type VideoProcessingProvider,type AvatarProvider,type StorageProvider} from '../../packages/types/src/index';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('BYOK-bound video jobs',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=isolatedTestDatabase(url),repo=new AvatarRepository(database.db),ledger=new LedgerRepository(database.db);
  const tenantId=randomUUID(),userId=randomUUID(),viewerId=randomUUID(),workspaceId=randomUUID(),brandId=randomUUID(),correlationId=randomUUID();let assetId='';
  const storage:StorageProvider={get:async()=>{throw new Error('Unexpected fixture read');},put:async()=>{},delete:async()=>{},signedDownload:async()=> 'https://storage.example.test/fixture.jpg'};
  const consent=new ConsentService(new ConsentRepository(database.db));
  const vault=new CredentialVault(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1'),keys=new ProviderKeyService(new ProviderKeyRepository(database.db),vault);
  const provider:AvatarProvider={create:async(_input,context)=>{return {provider:'heygen',internalId:context.internalId,externalId:`look-${context.internalId}`,metadata:{groupId:`group-${context.internalId}`}};},list:async()=>[],status:async()=>{return {status:'READY',previewUrl:null};},delete:async()=>{}};
  const avatarScopes:HeyGenCircuitScope[]=[];
  const byok={vault,provider:(secret:string,healthScope?:HeyGenCircuitScope)=>{expect(secret).toMatch(/^fixture-/);expect(healthScope).toMatchObject({tenantId});avatarScopes.push(healthScope!);return provider;}};
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
    await ledger.adjust(tenantId,'VIDEO_SECONDS',1000,randomUUID(),correlationId);
    await ledger.adjust(tenantId,'AI_CREDITS',200,randomUUID(),correlationId);
    const photo=await sharp({create:{width:100,height:100,channels:3,background:'#aaddff'}}).png().toBuffer();
    assetId=(await new MediaService(new MediaRepository(database.db),storage).upload(userId,tenantId,brandId,{name:'Fixture.png',mimeType:'image/png',idempotencyKey:randomUUID()},photo,correlationId)).id;
  });

  let submitted=0,checked=0,removed=0;
  const videoProvider:VideoProvider={submit:async(_input,context)=>{submitted++;return {provider:'heygen',externalId:`video-${context.internalId}`,internalId:context.internalId,metadata:{}};},status:async()=>{checked++;return {status:'READY',downloadUrl:'https://fixture.example.test/video.mp4'};},download:async()=>Buffer.from('original-fixture'),delete:async()=>{removed++;}};
  const processing:VideoProcessingProvider={prepareAudio:async()=>({bytes:Buffer.from('wav'),durationSeconds:11.2}),process:async input=>{for(const stage of ['CAPTIONS_GENERATING','BROLL_PROCESSING','COVER_GENERATING','QC'] as const)await input.onStage?.(stage,{});return {bytes:Buffer.from('final-fixture'),thumbnail:Buffer.from('cover'),durationSeconds:11.2,width:720,height:1280};}};
  const videoScopes:HeyGenCircuitScope[]=[];
  const videoByok={vault,provider:(secret:string,healthScope?:HeyGenCircuitScope)=>{expect(secret).toMatch(/^fixture-/);expect(healthScope).toMatchObject({tenantId});videoScopes.push(healthScope!);return videoProvider;}},videos=new VideoService(new VideoRepository(database.db),null,storage,true,null,videoByok),videoWorker=new VideoProcessor(database.db,null,storage,processing,true,null,undefined,videoByok);
  async function videoRequest(){
    const avatar=await queued();await processor.run(tenantId,avatar.job.id);await due(avatar.job.id);await processor.run(tenantId,avatar.job.id);expect((await row(avatar.job.id)).status).toBe('SUCCEEDED');
    const [look]=await database.client`select id,avatar_id from avatar_looks where job_id=${avatar.job.id}`;
    const voices=new VoiceRepository(database.db);await voices.savePage(userId,tenantId,brandId,'heygen',[{name:'Public fixture',language:'Russian',previewUrl:null,reference:{provider:'heygen',internalId:randomUUID(),externalId:'public-fixture',metadata:{public:true}}}]);const [voice]=await voices.list(userId,tenantId,brandId);await voices.select(userId,tenantId,brandId,look!.avatar_id,voice!.id,correlationId);
    const scriptId=randomUUID(),contentId=randomUUID();await database.client`insert into content_items(id,tenant_id,brand_id,title,type,status) values(${contentId},${tenantId},${brandId},'Fixture','SHORT_VIDEO','APPROVED_SCRIPT')`;
    await database.client`insert into scripts(id,tenant_id,brand_id,content_item_id,current_version,approved_version,approved_by,platform,duration) values(${scriptId},${tenantId},${brandId},${contentId},1,1,${userId},'YOUTUBE',30)`;
    await database.client`insert into script_versions(tenant_id,script_id,version,content,created_by) values(${tenantId},${scriptId},1,${JSON.stringify({hook:'Hook',context:'Context',core:'Core',proof:'Proof',cta:'CTA',factCheckNotes:[]})}::jsonb,${userId})`;
    const input={scriptId,scriptVersion:1,lookId:look!.id,orientation:'9:16',resolution:'720p',fit:'crop',idempotencyKey:randomUUID()};return {avatar,input};
  }
  async function queuedVideo(){const {avatar,input}=await videoRequest(),job=await videos.create(userId,tenantId,brandId,input,correlationId);await due(job.id);return {avatar,input,job};}
  it('inherits the exact avatar key and completes, downloads and cleans up without a shared connection',async()=>{
    const {avatar,input,job}=await queuedVideo();expect((await videos.create(userId,tenantId,brandId,input,correlationId)).id).toBe(job.id);expect((await row(job.id)).input.connection).toEqual(avatar.input.connection);
    await videoWorker.run(tenantId,job.id);expect((await row(job.id)).status).toBe('WAITING_EXTERNAL');await due(job.id);await videoWorker.run(tenantId,job.id);expect((await row(job.id)).status).toBe('SUCCEEDED');
    const [project]=await database.client`select * from video_projects where job_id=${job.id}`;expect(project!.provider_key_id).toBe(avatar.saved.id);expect(project!.provider_key_revision).toBe(avatar.saved.revision);
    await expect(database.client`update video_projects set provider_key_revision=provider_key_revision+1 where id=${project!.id}`).rejects.toThrow('immutable');
    expect(await videos.download(userId,tenantId,brandId,project!.id,correlationId)).toHaveProperty('videoUrl');await videos.delete(userId,tenantId,brandId,project!.id,correlationId);await database.client`update video_projects set delete_after=now()-interval '1 second' where id=${project!.id}`;expect(await videos.cleanupOne()).toBe(true);expect(removed).toBe(1);
    const healthScope={tenantId,providerKeyId:avatar.saved.id,revision:avatar.saved.revision};
    expect(avatarScopes.slice(-2)).toEqual([healthScope,healthScope]);
    expect(videoScopes.slice(-3)).toEqual([healthScope,healthScope,healthScope]);
  });
  it('rejects stale avatar bindings before reservation and never substitutes the platform key',async()=>{
    const {input}=await videoRequest();await key();const before=await database.client`select id from jobs where tenant_id=${tenantId} and type='GENERATE_VIDEO'`;
    await expect(new VideoService(new VideoRepository(database.db),{name:'heygen',provider:videoProvider},storage,true,null,videoByok).create(userId,tenantId,brandId,input,correlationId)).rejects.toThrow('CONFIGURATION_REQUIRED');expect(await database.client`select id from jobs where tenant_id=${tenantId} and type='GENERATE_VIDEO'`).toHaveLength(before.length);
  });
  it('refunds revoked unsubmitted work without a remote call',async()=>{
    const {avatar,job}=await queuedVideo(),before=submitted;await keys.revoke(userId,tenantId,brandId,avatar.saved.id,{revision:avatar.saved.revision},correlationId);await videoWorker.run(tenantId,job.id);expect(submitted).toBe(before);expect((await row(job.id)).status).toBe('FAILED');expect((await database.client`select status from usage_reservations where id=${(await row(job.id)).reservation_id}`)[0]?.status).toBe('RELEASED');
  });
  it.each(['revoke','replace'] as const)('retains submitted reservations and pending cleanup after %s',async(change)=>{
    const {avatar,job}=await queuedVideo();await videoWorker.run(tenantId,job.id);const before=checked;
    if(change==='revoke')await keys.revoke(userId,tenantId,brandId,avatar.saved.id,{revision:avatar.saved.revision},correlationId);else await key();
    await due(job.id);await videoWorker.run(tenantId,job.id);expect(checked).toBe(before);expect((await row(job.id)).status).toBe('RECONCILIATION');expect((await database.client`select status from usage_reservations where id=${(await row(job.id)).reservation_id}`)[0]?.status).toBe('HELD');
    const [project]=await database.client`select id from video_projects where job_id=${job.id}`;await expect(videos.resume(userId,tenantId,brandId,project!.id,correlationId)).rejects.toThrow('CONFIGURATION_REQUIRED');await videos.delete(userId,tenantId,brandId,project!.id,correlationId);await database.client`update video_projects set delete_after=now()-interval '1 second' where id=${project!.id}`;const beforeDelete=removed;await videos.cleanupOne();expect(removed).toBe(beforeDelete);expect((await database.client`select lifecycle from video_projects where id=${project!.id}`)[0]?.lifecycle).toBe('DELETE_PENDING');
  });
  it('refuses a shared worker connection when bound-key decryption is unavailable',async()=>{
    const {job}=await queuedVideo(),before=submitted;await new VideoProcessor(database.db,{name:'heygen',provider:videoProvider},storage,processing,true).run(tenantId,job.id);expect(submitted).toBe(before);expect((await row(job.id)).status).toBe('FAILED');
  });
});
