import {randomUUID} from 'node:crypto';
import {describe,it,expect,afterAll} from 'vitest';
import {createDatabase,JobRepository,LedgerRepository,PerformanceRepository,AnalyticsRepository,ContentRepository,BrandRepository} from '../../packages/db/src/index';
import {GenerationService} from '../../packages/core/src/generation';
import {GenerationOrchestrator} from '../../packages/ai/src/index';
import {MockLLMProvider} from '../../packages/providers/src/index';
import {emptyOnboarding,generationOptionsSchema,generationInputSchema,manualMetricsSchema,type PerformanceOutput} from '../../packages/types/src/index';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable performance reports and explicit strategy decisions',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=createDatabase(url??'postgresql://localhost/unused_test'),jobs=new JobRepository(database.db),ledger=new LedgerRepository(database.db),reports=new PerformanceRepository(database.db),analytics=new AnalyticsRepository(database.db),content=new ContentRepository(database.db);
  const orchestrator=new GenerationOrchestrator([{provider:new MockLLMProvider('test'),model:'mock-v1'}]);
  const recorder={async started(){},async succeeded(){},async failed(){}};
  afterAll(()=>database.close());
  async function fixture(){
    const tenantId=randomUUID(),brandId=randomUUID(),otherBrand=randomUUID(),workspaceId=randomUUID(),owner=randomUUID(),editor=randomUUID(),correlation=randomUUID();
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`performance-${owner}@example.test`},'unusable','Owner',now()),(${editor},${`performance-${editor}@example.test`},'unusable','Editor',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Performance tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER'),(${tenantId},${editor},'EDITOR')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Fixture')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name,onboarding_completed_at) values(${brandId},${tenantId},${workspaceId},'Fixture',now()),(${otherBrand},${tenantId},${workspaceId},'Other brand',now())`;
    await ledger.adjust(tenantId,'AI_CREDITS',200,'fixture-funding',correlation);
    const input={brain:emptyOnboarding('Fictional analytics brand'),brandRevision:0,options:generationOptionsSchema.parse({})};
    const context={internalId:randomUUID(),tenantId,idempotencyKey:randomUUID(),correlationId:correlation,signal:new AbortController().signal};
    const strategy=await orchestrator.run('GENERATE_STRATEGY',input,context,recorder);
    const initial=await jobs.enqueue(owner,tenantId,brandId,'GENERATE_STRATEGY',input,randomUUID(),'mock','mock-v1',correlation),claimed=(await jobs.claim(tenantId,initial.id))!;
    await jobs.complete(tenantId,initial.id,claimed.leaseToken!,strategy);
    const connectionId=randomUUID(),itemId=randomUUID(),calendarId=randomUUID(),publishingId=randomUUID(),publicationId=randomUUID();
    const publishedAt=new Date(Date.now()-2*86400_000),observedAt=new Date(Date.now()-86400_000);
    await database.client`insert into social_connections(id,tenant_id,brand_id,provider,name,reference,idempotency_key,input_hash,status,created_by) values(${connectionId},${tenantId},${brandId},'mock-telegram','Fixture',${JSON.stringify({provider:'mock-telegram',internalId:connectionId,externalId:'fixture',metadata:{}})},${randomUUID()},'fixture','REVOKED',${owner})`;
    await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${itemId},${tenantId},${brandId},'Fixture post','POST')`;
    await database.client`insert into calendar_entries(id,tenant_id,brand_id,content_item_id,planned_at,time_zone,platform,caption,idempotency_key,input_hash,created_by) values(${calendarId},${tenantId},${brandId},${itemId},${publishedAt.toISOString()},'UTC','TELEGRAM','Fixture',${randomUUID()},'fixture',${owner})`;
    await database.client`insert into publishing_jobs(id,tenant_id,brand_id,calendar_id,calendar_revision,content_item_id,connection_id,credential_version,provider,snapshot,status,scheduled_at,next_attempt_at,idempotency_key,input_hash,approved_by,correlation_id) values(${publishingId},${tenantId},${brandId},${calendarId},0,${itemId},${connectionId},1,'mock-telegram',${JSON.stringify({title:'Fixture post',type:'POST',caption:'Private caption not copied into prompt',privacy:'PUBLIC',commentsEnabled:false,timeZone:'UTC',videoProjectId:null,finalKey:'never-copy-private-storage-key'})},'PUBLISHED',${publishedAt.toISOString()},${publishedAt.toISOString()},${randomUUID()},'fixture',${owner},${correlation})`;
    await database.client`insert into publications(id,tenant_id,job_id,provider,reference,published_at) values(${publicationId},${tenantId},${publishingId},'mock-telegram',${JSON.stringify({provider:'mock-telegram',internalId:publicationId,externalId:'fixture',metadata:{}})},${publishedAt.toISOString()})`;
    const metric=await analytics.record(owner,tenantId,brandId,manualMetricsSchema.parse({publicationId,idempotencyKey:randomUUID(),observedAt:observedAt.toISOString(),sourceNote:'Fixture manual evidence',metrics:{views:0}}),correlation);
    const analysisInput={...input,options:generationOptionsSchema.parse({analysisDays:30})};
    const enqueue=(key=randomUUID())=>jobs.enqueue(owner,tenantId,brandId,'OPTIMIZE_STRATEGY',analysisInput,key,'mock','mock-v1',correlation);
    async function generated(){const job=await enqueue(),active=(await jobs.claim(tenantId,job.id))!,parsed=generationInputSchema.parse(job.input);const output=await orchestrator.run('OPTIMIZE_STRATEGY',parsed,context,recorder) as PerformanceOutput;return {job,active,output,parsed};}
    async function complete(){const work=await generated();await jobs.complete(tenantId,work.job.id,work.active.leaseToken!,work.output);return (await reports.list(owner,tenantId,brandId))[0]!;}
    return {tenantId,brandId,otherBrand,owner,editor,correlation,input,analysisInput,context,publicationId,observedAt,metric,enqueue,generated,complete};
  }
  it('freezes authorized evidence, reserves once and validates citations before atomic report capture',async()=>{
    const f=await fixture(),key=randomUUID(),[first,second]=await Promise.all([f.enqueue(key),f.enqueue(key)]);expect(first.id).toBe(second.id);
    await expect(database.client`update jobs set input='{}'::jsonb where id=${first.id}`).rejects.toThrow('immutable');
    const unrelated=randomUUID();await database.client`insert into jobs(id,tenant_id,brand_id,requested_by,type,input,input_hash,idempotency_key,reservation_id,provider,model,correlation_id) select ${unrelated},tenant_id,brand_id,requested_by,'GENERATE_SCRIPT',input,input_hash,${randomUUID()},reservation_id,provider,model,correlation_id from jobs where id=${first.id}`;
    expect(await database.client`delete from jobs where id=${unrelated} returning id`).toHaveLength(1);
    const parsed=generationInputSchema.parse(first.input);expect(parsed.performance!.evidence.publications[0]!.observation).toMatchObject({id:f.metric.id,metrics:{views:0,likes:null}});expect(JSON.stringify(parsed.performance)).not.toContain('never-copy-private-storage-key');
    await analytics.record(f.owner,f.tenantId,f.brandId,manualMetricsSchema.parse({publicationId:f.publicationId,idempotencyKey:randomUUID(),observedAt:f.observedAt.toISOString(),sourceNote:'Correction',metrics:{views:999}}),f.correlation);
    expect(generationInputSchema.parse((await f.enqueue(key)).input).performance).toEqual(parsed.performance);
    const active=(await jobs.claim(f.tenantId,first.id))!,output=await orchestrator.run('OPTIMIZE_STRATEGY',parsed,f.context,recorder) as PerformanceOutput;
    const invalid=structuredClone(output);invalid.recommendations[0]!.evidenceIds=[randomUUID()];await expect(jobs.complete(f.tenantId,first.id,active.leaseToken!,invalid)).rejects.toThrow('PROVIDER_REJECTED');
    expect(await reports.list(f.owner,f.tenantId,f.brandId)).toHaveLength(0);
    await jobs.complete(f.tenantId,first.id,active.leaseToken!,output);
    const saved=(await reports.list(f.owner,f.tenantId,f.brandId))[0]!;expect(saved.evidence).toEqual(parsed.performance!.evidence);expect(saved.recommendations).toHaveLength(1);
    expect((await content.overview(f.owner,f.tenantId,f.brandId)).strategies).toHaveLength(1);
    const captures=await database.client`select amount from usage_ledger where reservation_id=${first.reservationId} and type='CAPTURE'`;expect(captures).toHaveLength(1);expect(captures[0]!.amount).toBe(5);
    await expect(database.client`update performance_reports set output='{}'::jsonb where id=${saved.id}`).rejects.toThrow('Append-only');await expect(database.client`delete from strategy_recommendations where report_id=${saved.id}`).rejects.toThrow('Append-only');
  });
  it('enforces manager permissions and brand/tenant ownership without reserving rejected work',async()=>{
    const f=await fixture();await expect(jobs.enqueue(f.editor,f.tenantId,f.brandId,'OPTIMIZE_STRATEGY',f.analysisInput,randomUUID(),'mock','mock-v1',f.correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(jobs.enqueue(f.owner,f.tenantId,f.otherBrand,'OPTIMIZE_STRATEGY',f.analysisInput,randomUUID(),'mock','mock-v1',f.correlation)).rejects.toThrow('CONFLICT');
    const report=await f.complete(),decision={recommendationId:report.recommendations[0]!.id,decision:'ACCEPTED' as const,expectedVersion:1,idempotencyKey:randomUUID()};
    await expect(reports.decide(f.editor,f.tenantId,f.brandId,decision,f.correlation)).rejects.toThrow('NOT_AUTHORIZED');await expect(reports.decide(f.owner,f.tenantId,f.otherBrand,decision,f.correlation)).rejects.toThrow('NOT_FOUND');await expect(reports.list(randomUUID(),f.tenantId,f.brandId)).rejects.toThrow('NOT_FOUND');expect(await reports.list(f.owner,f.tenantId,f.otherBrand)).toEqual([]);
    expect((await ledger.overview(f.owner,f.tenantId)).balances.AI_CREDITS.reserved).toBe(0);
  });
  it('accepts concurrently exactly once, preserves historical strategy and never changes Brand Brain',async()=>{
    const f=await fixture(),report=await f.complete(),before=await database.client`select to_jsonb(b) as data from brands b where id=${f.brandId}`;
    const input={recommendationId:report.recommendations[0]!.id,decision:'ACCEPTED' as const,expectedVersion:1,idempotencyKey:randomUUID()};
    const [first,second]=await Promise.all([reports.decide(f.owner,f.tenantId,f.brandId,input,f.correlation),reports.decide(f.owner,f.tenantId,f.brandId,input,f.correlation)]);expect(first).toEqual(second);expect(first.appliedVersion).toBe(2);
    const versions=(await content.overview(f.owner,f.tenantId,f.brandId)).strategies;expect(versions.map(row=>row.version)).toEqual([2,1]);expect(versions[0]!.content.hypotheses).toEqual(report.recommendations[0]!.content.patch.value);expect(versions[1]!.content.hypotheses).not.toEqual(versions[0]!.content.hypotheses);
    expect(await database.client`select to_jsonb(b) as data from brands b where id=${f.brandId}`).toEqual(before);
    await expect(reports.decide(f.owner,f.tenantId,f.brandId,{...input,decision:'REJECTED'},f.correlation)).rejects.toThrow('CONFLICT');await expect(database.client`delete from strategy_recommendation_decisions where id=${first.id}`).rejects.toThrow('Append-only');
  });
  it('rejects without creating a version and permits rejection of stale recommendations',async()=>{
    const f=await fixture(),report=await f.complete();await database.client`update brands set revision=revision+1 where id=${f.brandId}`;
    const input={recommendationId:report.recommendations[0]!.id,decision:'ACCEPTED' as const,expectedVersion:1,idempotencyKey:randomUUID()};await expect(reports.decide(f.owner,f.tenantId,f.brandId,input,f.correlation)).rejects.toThrow('CONFLICT');
    const result=await reports.decide(f.owner,f.tenantId,f.brandId,{...input,decision:'REJECTED'},f.correlation);expect(result.appliedVersion).toBeNull();expect((await content.overview(f.owner,f.tenantId,f.brandId)).strategies).toHaveLength(1);
  });
  it('permits disjoint decisions from one report and rejects conflicting patches',async()=>{
    const f=await fixture(),work=await f.generated(),recommendation=work.output.recommendations[0]!;
    work.output.recommendations.push({...recommendation,title:'Different field',patch:{field:'frequency',value:'Две публикации в неделю'}},{...recommendation,title:'Conflicting field',patch:{field:'hypotheses',value:['A different hypothesis']}});
    await jobs.complete(f.tenantId,work.job.id,work.active.leaseToken!,work.output);const report=(await reports.list(f.owner,f.tenantId,f.brandId))[0]!;
    const decide=(index:number,expectedVersion:number)=>reports.decide(f.owner,f.tenantId,f.brandId,{recommendationId:report.recommendations[index]!.id,decision:'ACCEPTED',expectedVersion,idempotencyKey:randomUUID()},f.correlation);
    expect((await decide(0,1)).appliedVersion).toBe(2);await expect(decide(1,1)).rejects.toThrow('CONFLICT');expect((await decide(1,2)).appliedVersion).toBe(3);await expect(decide(2,3)).rejects.toThrow('CONFLICT');
  });
  it('rejects acceptance after a newly generated strategy supersedes the analyzed version',async()=>{
    const f=await fixture(),report=await f.complete(),job=await jobs.enqueue(f.owner,f.tenantId,f.brandId,'GENERATE_STRATEGY',f.input,randomUUID(),'mock','mock-v1',f.correlation),active=(await jobs.claim(f.tenantId,job.id))!;
    await jobs.complete(f.tenantId,job.id,active.leaseToken!,await orchestrator.run('GENERATE_STRATEGY',f.input,f.context,recorder));
    await expect(reports.decide(f.owner,f.tenantId,f.brandId,{recommendationId:report.recommendations[0]!.id,decision:'ACCEPTED',expectedVersion:2,idempotencyKey:randomUUID()},f.correlation)).rejects.toThrow('CONFLICT');
  });
  it('rechecks permissions and fences leases before writing reports; final failure releases reservation',async()=>{
    const f=await fixture(),work=await f.generated();await database.client`update jobs set lease_expires_at=now()-interval '1 second' where id=${work.job.id}`;
    const replacement=(await jobs.claim(f.tenantId,work.job.id))!;await expect(jobs.complete(f.tenantId,work.job.id,work.active.leaseToken!,work.output)).rejects.toThrow('CONFLICT');
    await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenantId} and user_id=${f.owner}`;await expect(jobs.complete(f.tenantId,work.job.id,replacement.leaseToken!,work.output)).rejects.toThrow('NOT_AUTHORIZED');
    await jobs.fail(f.tenantId,work.job.id,replacement.leaseToken!,'NOT_AUTHORIZED',false);expect(await reports.list(f.owner,f.tenantId,f.brandId)).toEqual([]);
    expect(await database.client`select id from usage_ledger where reservation_id=${work.job.reservationId} and type='RELEASE'`).toHaveLength(1);
  });
  it('rejects cross-tenant report access and foreign keys',async()=>{
    const first=await fixture(),second=await fixture(),report=await first.complete();
    await expect(reports.list(second.owner,first.tenantId,first.brandId)).rejects.toThrow('NOT_FOUND');
    await expect(reports.decide(second.owner,second.tenantId,second.brandId,{recommendationId:report.recommendations[0]!.id,decision:'ACCEPTED',expectedVersion:1,idempotencyKey:randomUUID()},second.correlation)).rejects.toThrow('NOT_FOUND');
    await expect(database.client`insert into strategy_recommendations(tenant_id,report_id,ordinal,content) values(${second.tenantId},${report.id},2,${JSON.stringify(report.recommendations[0]!.content)})`).rejects.toThrow();
  });
  it('blocks feature-disabled requests before any job is created',async()=>{
    const service=new GenerationService(jobs,new BrandRepository(database.db),ledger,content,{provider:'mock',model:'mock-v1',ready:true,analyticsAI:false});
    await expect(service.enqueue(randomUUID(),randomUUID(),randomUUID(),{type:'OPTIMIZE_STRATEGY',options:{analysisDays:30},idempotencyKey:randomUUID()},randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');
  });
});
