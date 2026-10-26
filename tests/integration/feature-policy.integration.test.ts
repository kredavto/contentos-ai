import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {FeaturePolicyRepository,BillingRepository,AvatarRepository} from '../../packages/db/src/index';
import {featurePolicyChangeSchema,type ManagedFeature} from '../../packages/types/src/index';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('scoped rollout policy and immutable operator evidence',()=>{
 const database=isolatedTestDatabase(url),repository=new FeaturePolicyRepository(database.db);
 async function user(){const id=randomUUID();await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${id+'@example.test'},'Policy fixture','unusable',now())`;return id;}
 async function fixture(){const actor=await user(),support=await user(),owner=await user(),tenant=randomUUID();await database.client`insert into platform_operators(user_id,role) values(${actor},'ADMIN'),(${support},'SUPPORT')`;await database.client`insert into organizations(id,name) values(${tenant},'Policy fixture')`;await database.client`insert into organization_members(user_id,tenant_id,role) values(${owner},${tenant},'OWNER')`;return {actor,support,owner,tenant};}
 const input=(feature:ManagedFeature,scope:'GLOBAL'|'PLAN'|'ORGANIZATION'|'USER',targetId:string|null,mode:'ENABLED'|'DISABLED'|'INHERIT',expectedRevision=0)=>featurePolicyChangeSchema.parse({feature,scope,targetId,mode,expectedRevision,ticket:'POLICY-1',idempotencyKey:randomUUID()});
 async function enabled(userId:string,tenant:string,feature:ManagedFeature){return (await repository.overview(userId,tenant)).features.find(row=>row.feature===feature)!;}
 it('keeps existing rollout defaults but does not opt users into autopilot',async()=>{
  const f=await fixture();expect(await enabled(f.owner,f.tenant,'avatar_generation')).toMatchObject({enabled:true,source:'DEFAULT'});expect(await enabled(f.owner,f.tenant,'autopilot')).toMatchObject({enabled:false,source:'DEFAULT'});
  await expect(repository.overview(f.actor,f.tenant)).rejects.toThrow('NOT_FOUND');
 });
 it('requires current platform authority before disclosing targets or mutating',async()=>{
  const f=await fixture(),raw=input('video_generation','ORGANIZATION',f.tenant,'DISABLED');
  for(const actor of [f.owner,f.support])await expect(repository.change(actor,raw,randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  await expect(repository.inspect(f.owner,{feature:'video_generation',scope:'USER',targetId:randomUUID()},randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  expect((await repository.inspect(f.support,rawTarget(raw),randomUUID())).canManage).toBe(false);
  await expect(repository.change(f.actor,{...raw,targetId:randomUUID()},randomUUID())).rejects.toThrow('NOT_FOUND');
  await database.client`update platform_operators set revoked_at=now() where user_id=${f.actor}`;await expect(repository.change(f.actor,raw,randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
 });
 function rawTarget(raw:ReturnType<typeof input>){return {feature:raw.feature,scope:raw.scope,targetId:raw.targetId};}
 it('resolves USER over ORGANIZATION over PLAN over GLOBAL and skips inherited rules',async()=>{
  const f=await fixture(),[free]=await database.client`select id from plans where code='FREE'`;
  const global=await repository.change(f.actor,input('comments','GLOBAL',null,'DISABLED'),randomUUID());
  try{
   expect(await enabled(f.owner,f.tenant,'comments')).toMatchObject({enabled:false,source:'GLOBAL'});
   await repository.change(f.actor,input('comments','PLAN',String(free!.id),'ENABLED'),randomUUID());expect(await enabled(f.owner,f.tenant,'comments')).toMatchObject({enabled:true,source:'PLAN'});
   await repository.change(f.actor,input('comments','ORGANIZATION',f.tenant,'DISABLED'),randomUUID());expect(await enabled(f.owner,f.tenant,'comments')).toMatchObject({enabled:false,source:'ORGANIZATION'});
   await repository.change(f.actor,input('comments','USER',f.owner,'ENABLED'),randomUUID());expect(await enabled(f.owner,f.tenant,'comments')).toMatchObject({enabled:true,source:'USER'});
   await repository.change(f.actor,input('comments','USER',f.owner,'INHERIT',1),randomUUID());expect(await enabled(f.owner,f.tenant,'comments')).toMatchObject({enabled:false,source:'ORGANIZATION'});
   const other=await fixture();expect(await enabled(other.owner,other.tenant,'comments')).toMatchObject({enabled:true,source:'PLAN'});
  }finally{await repository.change(f.actor,input('comments','GLOBAL',null,'INHERIT',global.revision),randomUUID());await repository.change(f.actor,input('comments','PLAN',String(free!.id),'INHERIT',1),randomUUID());}
 });
 it('uses a settled current plan and ignores expired terms without rewriting purchased terms',async()=>{
  const f=await fixture(),[plan]=await database.client`update plans set enabled=true where code='EXPERT' returning id`,version=randomUUID();
  await database.client`insert into plan_versions(id,plan_id,version,amount_minor,ai_credits,video_seconds) values(${version},${plan!.id},1,10000,100,100)`;
  await repository.change(f.actor,input('analytics_ai','PLAN',String(plan!.id),'DISABLED'),randomUUID());
  expect(await enabled(f.owner,f.tenant,'analytics_ai')).toMatchObject({enabled:true,source:'DEFAULT'});
  const billing=new BillingRepository(database.db),merchant={provider:'yookassa' as const,merchantId:'100500',test:true};
  const order=await billing.checkout(f.owner,f.tenant,version,randomUUID(),{returnUrl:'https://app.example.test/billing',receipt:{customerEmail:'fixture@example.test',vatCode:11,subject:'service',mode:'full_payment'}},merchant,randomUUID());
  await billing.settle(f.tenant,order.id,{...merchant,externalId:randomUUID(),internalId:order.id,amountMinor:10000,currency:'RUB',status:'SUCCEEDED',paid:true});
  expect(await enabled(f.owner,f.tenant,'analytics_ai')).toMatchObject({enabled:false,source:'PLAN'});
  expect((await database.client`select plan_version_id from subscription_terms where tenant_id=${f.tenant}`)[0]?.plan_version_id).toBe(version);
  const expired=await fixture(),pastBilling=new BillingRepository(database.db,()=>new Date(Date.now()-40*86400000)),oldOrder=await pastBilling.checkout(expired.owner,expired.tenant,version,randomUUID(),{returnUrl:'https://app.example.test/billing',receipt:{customerEmail:'fixture@example.test',vatCode:11,subject:'service',mode:'full_payment'}},merchant,randomUUID());
  await pastBilling.settle(expired.tenant,oldOrder.id,{...merchant,externalId:randomUUID(),internalId:oldOrder.id,amountMinor:10000,currency:'RUB',status:'SUCCEEDED',paid:true});
  expect(await enabled(expired.owner,expired.tenant,'analytics_ai')).toMatchObject({enabled:true,source:'DEFAULT'});
 });
 it('deduplicates concurrent retries, fences stale revisions and never replays old changes over newer state',async()=>{
  const f=await fixture(),raw=input('byok','ORGANIZATION',f.tenant,'DISABLED');const results=await Promise.all([repository.change(f.actor,raw,randomUUID()),repository.change(f.actor,raw,randomUUID())]);expect(results[0]?.id).toBe(results[1]?.id);
  expect(await database.client`select id from feature_policy_changes where policy_id=${results[0]!.id}`).toHaveLength(1);
  await expect(repository.change(f.actor,{...raw,ticket:'DIFFERENT'},randomUUID())).rejects.toThrow('CONFLICT');
  const next=input('byok','ORGANIZATION',f.tenant,'ENABLED',1);await repository.change(f.actor,next,randomUUID());
  expect((await repository.change(f.actor,raw,randomUUID())).replayed).toBe(true);expect(await enabled(f.owner,f.tenant,'byok')).toMatchObject({enabled:true});
  await expect(repository.change(f.actor,{...next,idempotencyKey:randomUUID()},randomUUID())).rejects.toThrow('CONFLICT');
  await expect(database.client`update feature_policy_changes set ticket='CHANGED' where policy_id=${results[0]!.id}`).rejects.toThrow();await expect(database.client`delete from feature_policies where id=${results[0]!.id}`).rejects.toThrow();await expect(database.client`update feature_policies set mode='DISABLED',revision=revision+1 where id=${results[0]!.id}`).rejects.toThrow();
 });
 it('serializes competing edits of the same previously absent scope',async()=>{
  const f=await fixture(),raw=input('trend_radar','ORGANIZATION',f.tenant,'DISABLED');const results=await Promise.allSettled([repository.change(f.actor,raw,randomUUID()),repository.change(f.actor,{...raw,idempotencyKey:randomUUID(),mode:'ENABLED'},randomUUID())]);expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
 });
 it('denies disabled avatar admission before creating resources or spending credit, while reads remain available',async()=>{
  const f=await fixture();await repository.change(f.actor,input('avatar_generation','ORGANIZATION',f.tenant,'DISABLED'),randomUUID());
  await expect(new AvatarRepository(database.db).enqueue(f.owner,f.tenant,randomUUID(),{name:'Must not create',sourceAssetId:randomUUID(),subjectId:randomUUID(),likenessType:'OWN_LIKENESS',idempotencyKey:randomUUID()},[],'mock',randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  expect(await database.client`select id from jobs where tenant_id=${f.tenant}`).toHaveLength(0);expect(await database.client`select id from usage_reservations where tenant_id=${f.tenant}`).toHaveLength(0);
  expect((await repository.overview(f.owner,f.tenant)).features).toHaveLength(12);
 });
});
