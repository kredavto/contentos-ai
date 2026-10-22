import {randomUUID,randomBytes} from 'node:crypto';
import {beforeAll,describe,it,expect} from 'vitest';
import {BillingRepository,ProviderKeyRepository,VoiceRepository} from '../../packages/db/src/index';
import {VoiceService} from '../../packages/core/src/voices';
import {ProviderKeyService} from '../../packages/core/src/provider-keys';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('tenant/brand BYOK storage foundation',()=>{
 const database=isolatedTestDatabase(url),repository=new ProviderKeyRepository(database.db),vault=new CredentialVault(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1'),service=new ProviderKeyService(repository,vault);
 const versions=new Map<string,string>(),merchant={provider:'yookassa' as const,merchantId:'100500',test:true};
 beforeAll(async()=>{for(const code of ['EXPERT','AGENCY','CREATOR']){const [plan]=await database.client`update plans set enabled=true where code=${code} returning id`;const id=randomUUID();versions.set(code,id);await database.client`insert into plan_versions(id,plan_id,version,amount_minor,ai_credits,video_seconds) values(${id},${plan!.id},1,10000,100,100)`;}});
 async function fixture(code='EXPERT',date=new Date()){
  const tenant=randomUUID(),user=randomUUID(),editor=randomUUID(),workspace=randomUUID(),brand=randomUUID();await database.client`insert into organizations(id,name) values(${tenant},'BYOK fixture')`;
  for(const [id,role] of [[user,'OWNER'],[editor,'EDITOR']]){await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${id!},${`${id}@example.test`},'unusable','Fixture',now())`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${id!},${role!})`;}
  await database.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenant},'Fixture')`;await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brand},${tenant},${workspace},'Fixture')`;
  if(code!=='FREE'){const billing=new BillingRepository(database.db,()=>date),order=await billing.checkout(user,tenant,versions.get(code)!,randomUUID(),{returnUrl:'https://app.example.test/billing',receipt:{customerEmail:'fixture@example.test',vatCode:11,subject:'service',mode:'full_payment'}},merchant,randomUUID());await billing.settle(tenant,order.id,{...merchant,externalId:randomUUID(),internalId:order.id,amountMinor:10000,currency:'RUB',status:'SUCCEEDED',paid:true});}
  return {tenant,user,editor,brand};
 }
 const secret=()=>`fixture-only-${randomUUID()}`;
 it('stores only authenticated ciphertext and masked metadata, without leaking credentials to audit',async()=>{
  const f=await fixture(),apiKey=secret(),saved=await service.save(f.user,f.tenant,f.brand,{provider:'heygen',apiKey,revision:null},randomUUID());
  expect(saved.maskedKey).toBe(`••••••••${apiKey.slice(-4)}`);expect(saved).not.toHaveProperty('credential');
  const row=await repository.resolve(f.user,f.tenant,f.brand,saved.id,saved.revision);expect(JSON.stringify(row)).not.toContain(apiKey);
  const scope={kind:'PROVIDER_KEY' as const,tenantId:f.tenant,brandId:f.brand,connectionId:saved.id,provider:'heygen' as const};expect(vault.decrypt(row.credential!,scope)).toBe(apiKey);
  expect(()=>vault.decrypt(row.credential!,{tenantId:f.tenant,brandId:f.brand,connectionId:saved.id,provider:'heygen'})).toThrow('CONFIGURATION_REQUIRED');
  for(const change of [{tenantId:randomUUID()},{brandId:randomUUID()},{connectionId:randomUUID()},{provider:'openai' as const}])expect(()=>vault.decrypt(row.credential!,{...scope,...change})).toThrow('CONFIGURATION_REQUIRED');
  expect(JSON.stringify(await database.client`select metadata from audit_logs where resource_id=${saved.id}`)).not.toContain(apiKey);expect((await service.list(f.user,f.tenant,f.brand))[0]).toEqual(saved);
  await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenant} and user_id=${f.editor}`;await expect(repository.resolve(f.editor,f.tenant,f.brand,saved.id,saved.revision)).rejects.toThrow('NOT_AUTHORIZED');
  await expect(repository.resolve(f.user,f.tenant,randomUUID(),saved.id,saved.revision)).rejects.toThrow('CONFIGURATION_REQUIRED');
 });
 it.each(['FREE','CREATOR'])('denies %s entitlement before saving a secret',async(code)=>{
  const f=await fixture(code);await expect(service.save(f.user,f.tenant,f.brand,{provider:'heygen',apiKey:secret(),revision:null},randomUUID())).rejects.toThrow('PLAN_LIMIT_REACHED');expect(await service.list(f.user,f.tenant,f.brand)).toEqual([]);
 });
 it('rejects future terms, accepts active Agency, and permits revocation after entitlement expiry',async()=>{
  const future=await fixture('EXPERT',new Date(Date.now()+40*86400000));await expect(service.save(future.user,future.tenant,future.brand,{provider:'heygen',apiKey:secret(),revision:null},randomUUID())).rejects.toThrow('PLAN_LIMIT_REACHED');
  const agency=await fixture('AGENCY');expect((await service.save(agency.user,agency.tenant,agency.brand,{provider:'openai',apiKey:secret(),revision:null},randomUUID())).status).toBe('ACTIVE');
  const past=await fixture('EXPERT',new Date(Date.now()-90*86400000)),id=randomUUID(),credential=vault.encrypt(secret(),{kind:'PROVIDER_KEY',tenantId:past.tenant,brandId:past.brand,connectionId:id,provider:'heygen'});
  await database.client`insert into provider_keys(id,tenant_id,brand_id,provider,credential,masked_key,status,created_by) values(${id},${past.tenant},${past.brand},'heygen',${JSON.stringify(credential)}::jsonb,'••••••••test','ACTIVE',${past.user})`;
  await expect(repository.resolve(past.user,past.tenant,past.brand,id,0)).rejects.toThrow('PLAN_LIMIT_REACHED');expect((await service.revoke(past.user,past.tenant,past.brand,id,{revision:0},randomUUID())).status).toBe('REVOKED');
  expect((await database.client`select credential from provider_keys where id=${id}`)[0]?.credential).toBeNull();
 });
 it('fences concurrent writes, stale execution revisions and revoked credentials',async()=>{
  const f=await fixture(),input={provider:'heygen',apiKey:secret(),revision:null};const results=await Promise.allSettled([service.save(f.user,f.tenant,f.brand,input,randomUUID()),service.save(f.user,f.tenant,f.brand,input,randomUUID())]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const first=(await service.list(f.user,f.tenant,f.brand))[0]!,next=await service.save(f.user,f.tenant,f.brand,{...input,apiKey:secret(),revision:first.revision},randomUUID());expect(next.id).toBe(first.id);expect(next.revision).toBe(first.revision+1);
  await expect(repository.resolve(f.user,f.tenant,f.brand,first.id,first.revision)).rejects.toThrow('CONFIGURATION_REQUIRED');
  await expect(service.revoke(f.user,f.tenant,f.brand,first.id,{revision:first.revision},randomUUID())).rejects.toThrow('CONFLICT');
  const revoked=await service.revoke(f.user,f.tenant,f.brand,next.id,{revision:next.revision},randomUUID());await expect(repository.resolve(f.user,f.tenant,f.brand,next.id,revoked.revision)).rejects.toThrow('CONFIGURATION_REQUIRED');
  await expect(database.client`update provider_keys set provider='openai',revision=revision+1 where id=${next.id}`).rejects.toThrow('immutable');
 });
 it('uses only the explicitly bound brand key for public catalog requests',async()=>{
  const f=await fixture(),apiKey=secret(),saved=await service.save(f.user,f.tenant,f.brand,{provider:'heygen',apiKey,revision:null},randomUUID());
  let calls=0;
  const voices=new VoiceService(new VoiceRepository(database.db),null,{repository,vault,catalog:key=>{expect(key).toBe(apiKey);return {listPublicVoicePage:async(cursor,context)=>{calls++;expect(cursor).toBe('page-2');expect(context.tenantId).toBe(f.tenant);return {voices:[{name:'Public fixture',language:'Russian',previewUrl:null,reference:{provider:'heygen',internalId:context.internalId,externalId:'public-fixture',metadata:{public:true}}}],nextCursor:null};}};}});
  expect(await voices.refresh(f.editor,f.tenant,f.brand,{connection:{id:saved.id,revision:saved.revision},cursor:'page-2'},randomUUID())).toEqual({nextCursor:null});
  expect(calls).toBe(1);const rows=await new VoiceRepository(database.db).list(f.user,f.tenant,f.brand);expect(rows).toHaveLength(1);expect(JSON.stringify(rows)).not.toContain(apiKey);
  await service.revoke(f.user,f.tenant,f.brand,saved.id,{revision:saved.revision},randomUUID());
  await expect(voices.refresh(f.editor,f.tenant,f.brand,{connection:{id:saved.id,revision:saved.revision}},randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');expect(calls).toBe(1);
 });
 it.each(['revoke','replace','role'] as const)('discards a public catalog response after concurrent %s',async(change)=>{
  const f=await fixture(),saved=await service.save(f.user,f.tenant,f.brand,{provider:'heygen',apiKey:secret(),revision:null},randomUUID());
  const voices=new VoiceService(new VoiceRepository(database.db),null,{repository,vault,catalog:()=>({listPublicVoicePage:async(_cursor,context)=>{
   if(change==='revoke')await service.revoke(f.user,f.tenant,f.brand,saved.id,{revision:saved.revision},randomUUID());
   if(change==='replace')await service.save(f.user,f.tenant,f.brand,{provider:'heygen',apiKey:secret(),revision:saved.revision},randomUUID());
   if(change==='role')await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenant} and user_id=${f.editor}`;
   return {voices:[{name:'Discard me',language:null,previewUrl:null,reference:{provider:'heygen',internalId:context.internalId,externalId:'public-fixture',metadata:{public:true}}}],nextCursor:null};
  }})});
  await expect(voices.refresh(f.editor,f.tenant,f.brand,{connection:{id:saved.id,revision:saved.revision}},randomUUID())).rejects.toThrow(change==='role'?'NOT_AUTHORIZED':'CONFIGURATION_REQUIRED');
  expect(await database.client`select id from voice_profiles where tenant_id=${f.tenant}`).toHaveLength(0);
 });
 it('does not fall back to a shared catalog for foreign, stale or incompatible BYOK references',async()=>{
  const f=await fixture(),other=await fixture(),saved=await service.save(f.user,f.tenant,f.brand,{provider:'openai',apiKey:secret(),revision:null},randomUUID());let calls=0;
  const provider={listPublicVoicePage:async()=>{calls++;return {voices:[],nextCursor:null};}};
  const voices=new VoiceService(new VoiceRepository(database.db),{name:'heygen',provider},{repository,vault,catalog:()=>provider});
  await expect(voices.refresh(f.editor,f.tenant,f.brand,{connection:{id:saved.id,revision:0}},randomUUID())).rejects.toThrow('INVALID_INPUT');
  await expect(voices.refresh(other.user,other.tenant,other.brand,{connection:{id:saved.id,revision:0}},randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');
  await expect(voices.refresh(f.editor,f.tenant,f.brand,{connection:{id:saved.id,revision:1}},randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');
  await expect(voices.refresh(f.editor,f.tenant,f.brand,{connection:{id:saved.id,revision:0,apiKey:secret()}},randomUUID())).rejects.toThrow();expect(calls).toBe(0);
 });
 it('checks a key read-only, audits only a current binding and rate-limits reads',async()=>{
  const f=await fixture(),apiKey=secret(),saved=await service.save(f.user,f.tenant,f.brand,{provider:'heygen',apiKey,revision:null},randomUUID());let calls=0;
  const checking=new ProviderKeyService(repository,vault,async(key,context)=>{calls++;expect(key).toBe(apiKey);expect(context.internalId).toBe(saved.id);expect(context.tenantId).toBe(f.tenant);});
  await expect(checking.verify(f.editor,f.tenant,f.brand,saved.id,{revision:0},randomUUID())).rejects.toThrow('NOT_AUTHORIZED');expect(calls).toBe(0);
  for(let i=0;i<10;i++)expect(await checking.verify(f.user,f.tenant,f.brand,saved.id,{revision:0},randomUUID())).toEqual({accepted:true});
  await expect(checking.verify(f.user,f.tenant,f.brand,saved.id,{revision:0},randomUUID())).rejects.toThrow('RATE_LIMITED');expect(calls).toBe(10);
  const audits=await database.client`select metadata from audit_logs where resource_id=${saved.id} and action='PROVIDER_KEY_CHECKED'`;expect(audits).toHaveLength(10);expect(audits.every(row=>JSON.stringify(row.metadata)==='{}')).toBe(true);expect((await service.list(f.user,f.tenant,f.brand))[0]?.revision).toBe(0);
 });
 it.each(['revoke','replace','role'] as const)('rejects a stale verification response after %s',async(change)=>{
  const f=await fixture(),saved=await service.save(f.user,f.tenant,f.brand,{provider:'heygen',apiKey:secret(),revision:null},randomUUID());
  const checking=new ProviderKeyService(repository,vault,async()=>{
   if(change==='revoke')await service.revoke(f.user,f.tenant,f.brand,saved.id,{revision:0},randomUUID());
   if(change==='replace')await service.save(f.user,f.tenant,f.brand,{provider:'heygen',apiKey:secret(),revision:0},randomUUID());
   if(change==='role')await database.client`update organization_members set role='EDITOR' where tenant_id=${f.tenant} and user_id=${f.user}`;
  });
  await expect(checking.verify(f.user,f.tenant,f.brand,saved.id,{revision:0},randomUUID())).rejects.toThrow(change==='role'?'NOT_AUTHORIZED':'CONFIGURATION_REQUIRED');expect(await database.client`select id from audit_logs where resource_id=${saved.id} and action='PROVIDER_KEY_CHECKED'`).toHaveLength(0);
 });
 it('does not audit provider failure as successful verification',async()=>{
  const f=await fixture(),saved=await service.save(f.user,f.tenant,f.brand,{provider:'heygen',apiKey:secret(),revision:null},randomUUID());const checking=new ProviderKeyService(repository,vault,async()=>{throw new Error('fixture rejection');});
  await expect(checking.verify(f.user,f.tenant,f.brand,saved.id,{revision:0},randomUUID())).rejects.toThrow('fixture rejection');expect(await database.client`select id from audit_logs where resource_id=${saved.id} and action='PROVIDER_KEY_CHECKED'`).toHaveLength(0);
 });
 it('enforces owner, tenant, brand and verified-account boundaries and missing encryption configuration',async()=>{
  const f=await fixture(),other=await fixture(),input={provider:'heygen',apiKey:secret(),revision:null};
  await expect(service.save(f.editor,f.tenant,f.brand,input,randomUUID())).rejects.toThrow('NOT_AUTHORIZED');await expect(service.list(f.user,other.tenant,other.brand)).rejects.toThrow('NOT_FOUND');await expect(service.save(f.user,f.tenant,other.brand,input,randomUUID())).rejects.toThrow('NOT_FOUND');
  await expect(new ProviderKeyService(repository,null).save(f.user,f.tenant,f.brand,input,randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');
  await database.client`update users set email_verified_at=null where id=${f.user}`;await expect(service.save(f.user,f.tenant,f.brand,input,randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
 });
});
