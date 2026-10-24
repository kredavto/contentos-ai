import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { NotificationRepository, BrandRepository, ContentRepository, JobRepository, LedgerRepository } from '../../packages/db/src/index';
import { NotificationService } from '../../packages/core/src/notifications';
import { GenerationService } from '../../packages/core/src/generation';
import { GenerationOrchestrator } from '../../packages/ai/src/index';
import { MockLLMProvider } from '../../packages/providers/src/index';
import { generationInputSchema, carouselSchema } from '../../packages/types/src/index';
import { seedDevelopment, demoIds } from '../../packages/db/src/development-seed';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('versioned carousel creation and approval',()=>{
  const database=isolatedTestDatabase(url),jobs=new JobRepository(database.db),content=new ContentRepository(database.db),ledger=new LedgerRepository(database.db),service=new GenerationService(jobs,new BrandRepository(database.db),ledger,content,{provider:'mock',model:'mock-v1',ready:true});
  const {user,tenant,brand}=demoIds,correlation=randomUUID();let carouselId='';
  const input={type:'GENERATE_CAROUSEL',options:{topic:'Fictional course',platform:'TELEGRAM'},idempotencyKey:randomUUID()};
  beforeAll(async()=>{await seedDevelopment(database.db,`scrypt:v1:${'0'.repeat(32)}:${'0'.repeat(128)}`);});
  it('creates one carousel/immutable version and captures once for concurrent retry',async()=>{
    const saved=await Promise.all([service.enqueue(user,tenant,brand,input,correlation),service.enqueue(user,tenant,brand,input,correlation)]);expect(saved[0]?.id).toBe(saved[1]?.id);
    await expect(service.enqueue(user,tenant,brand,{...input,options:{...input.options,topic:'Changed'}},correlation)).rejects.toThrow('CONFLICT');
    const job=await jobs.claim(tenant,saved[0]!.id);expect(job?.leaseToken).toBeTruthy();
    const output=await new GenerationOrchestrator([{provider:new MockLLMProvider('test'),model:'mock-v1'}]).run('GENERATE_CAROUSEL',generationInputSchema.parse(job!.input),{tenantId:tenant,internalId:job!.id,idempotencyKey:job!.idempotencyKey,correlationId:correlation,signal:AbortSignal.timeout(10000)},{async started(){},async succeeded(){},async failed(){}});
    const result=await jobs.complete(tenant,job!.id,job!.leaseToken!,output);carouselId=result.internalId;
    expect(carouselSchema.safeParse(output).success).toBe(true);
    const overview=await content.overview(user,tenant,brand);expect(overview.carousels).toHaveLength(1);expect(overview.carousels[0]?.approvedVersion).toBeNull();await expect(service.authorizeCarouselExport(user,tenant,brand,carouselId,{revision:'1',lifecycleRevision:'0'})).rejects.toThrow('CONFLICT');
    expect((await ledger.overview(user,tenant)).balances.AI_CREDITS).toEqual({available:95,reserved:0});
    const notices=new NotificationRepository(database.db);await notices.projectBatch(tenant);await notices.projectBatch(tenant);
    const inbox=await new NotificationService(notices).list(user,tenant,{});expect(inbox.items.filter(item=>item.type==='CONTENT_APPROVAL_REQUIRED')).toHaveLength(1);expect(inbox.items.find(item=>item.type==='CONTENT_APPROVAL_REQUIRED')?.href).toContain('&tab=carousels');
    await expect(jobs.complete(tenant,job!.id,job!.leaseToken!,output)).rejects.toThrow('CONFLICT');
  });
  it('appends concurrent-safe edits and clears previous approval without changing history',async()=>{
    await service.editCarousel(user,tenant,brand,carouselId,{revision:1,content:null},correlation);
    const original=(await content.carouselHistory(user,tenant,brand,carouselId))[0]!.content;
    const results=await Promise.allSettled(['first','second'].map(caption=>service.editCarousel(user,tenant,brand,carouselId,{revision:1,content:{...original,caption}},correlation)));
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const history=await service.carouselHistory(user,tenant,brand,carouselId);expect(history).toHaveLength(2);expect(history[1]!.content).toEqual(original);
    expect((await content.overview(user,tenant,brand)).carousels[0]?.approvedVersion).toBeNull();
    await expect(database.client`update carousel_versions set version=10 where carousel_id=${carouselId}`).rejects.toThrow();
    await expect(database.client`delete from carousel_versions where carousel_id=${carouselId}`).rejects.toThrow();
    await expect(service.editCarousel(user,tenant,brand,carouselId,{revision:1,content:null},correlation)).rejects.toThrow('CONFLICT');
  });
  it('enforces scope and distinct writer/approver roles with idempotent approval',async()=>{
    await expect(service.carouselHistory(user,tenant,randomUUID(),carouselId)).rejects.toThrow('NOT_FOUND');
    const current=(await service.carouselHistory(user,tenant,brand,carouselId))[0]!.content;
    await database.client`update organization_members set role='EDITOR' where tenant_id=${tenant} and user_id=${user}`;
    await expect(service.editCarousel(user,tenant,brand,carouselId,{revision:2,content:null},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update organization_members set role='CLIENT_APPROVER' where tenant_id=${tenant} and user_id=${user}`;
    await expect(service.editCarousel(user,tenant,brand,carouselId,{revision:2,content:current},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await service.editCarousel(user,tenant,brand,carouselId,{revision:2,content:null},correlation);await service.editCarousel(user,tenant,brand,carouselId,{revision:2,content:null},correlation);
    expect(await database.client`select id from audit_logs where action='CAROUSEL_APPROVED' and resource_id=${carouselId}`).toHaveLength(2);
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${user}`;
    expect((await service.carouselHistory(user,tenant,brand,carouselId))).toHaveLength(2);
    await expect(service.enqueue(user,tenant,brand,{...input,idempotencyKey:randomUUID()},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update organization_members set role='OWNER' where tenant_id=${tenant} and user_id=${user}`;
  });
  it('authorizes only the current approved version for readers in the same tenant and brand',async()=>{
    const query={revision:'2',lifecycleRevision:'0'};
    expect(await service.authorizeCarouselExport(user,tenant,brand,carouselId,query)).toEqual({version:2,lifecycleRevision:0});
    await expect(service.authorizeCarouselExport(user,tenant,brand,carouselId,{...query,revision:'1'})).rejects.toThrow('CONFLICT');
    await expect(service.authorizeCarouselExport(user,tenant,randomUUID(),carouselId,query)).rejects.toThrow('NOT_FOUND');
    await expect(service.authorizeCarouselExport(randomUUID(),tenant,brand,carouselId,query)).rejects.toThrow('NOT_FOUND');
    const other=randomUUID();await database.client`insert into organizations(id,name) values(${other},'Export isolation')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${other},${user},'OWNER')`;
    await expect(service.authorizeCarouselExport(user,other,brand,carouselId,query)).rejects.toThrow('NOT_FOUND');
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${user}`;
    expect(await service.authorizeCarouselExport(user,tenant,brand,carouselId,query)).toHaveProperty('version',2);
    await database.client`update organization_members set role='OWNER' where tenant_id=${tenant} and user_id=${user}`;
  });
  it('archives and restores without losing versions, reusing approval or accepting stale editors',async()=>{
    const history=await service.carouselHistory(user,tenant,brand,carouselId),before=(await ledger.overview(user,tenant)).balances;
    const archive={revision:2,lifecycleRevision:0,archived:true};
    expect(await service.setCarouselArchived(user,tenant,brand,carouselId,archive,correlation)).toEqual({lifecycleRevision:1,archived:true});
    await service.setCarouselArchived(user,tenant,brand,carouselId,archive,correlation);
    const overview=await content.overview(user,tenant,brand);expect(overview.carousels).toHaveLength(0);expect(overview.archivedCarousels).toHaveLength(1);expect(overview.archivedCarousels[0]?.approvedVersion).toBeNull();await expect(service.authorizeCarouselExport(user,tenant,brand,carouselId,{revision:'2',lifecycleRevision:'1'})).rejects.toThrow('CONFLICT');
    expect(await service.carouselHistory(user,tenant,brand,carouselId)).toEqual(history);
    for(const value of [null,history[0]!.content])await expect(service.editCarousel(user,tenant,brand,carouselId,{revision:2,lifecycleRevision:1,content:value},correlation)).rejects.toThrow('CONFLICT');
    await expect(database.client`update carousels set approved_version=2 where id=${carouselId}`).rejects.toThrow();
    await expect(database.client`update carousels set lifecycle_revision=-1 where id=${carouselId}`).rejects.toThrow();
    const restore={revision:2,lifecycleRevision:1,archived:false};
    await service.setCarouselArchived(user,tenant,brand,carouselId,restore,correlation);await service.setCarouselArchived(user,tenant,brand,carouselId,restore,correlation);
    const restored=(await content.overview(user,tenant,brand)).carousels[0]!;expect(restored.lifecycleRevision).toBe(2);expect(restored.approvedVersion).toBeNull();expect(restored.archivedAt).toBeNull();await expect(service.authorizeCarouselExport(user,tenant,brand,carouselId,{revision:'2',lifecycleRevision:'2'})).rejects.toThrow('CONFLICT');
    await expect(service.editCarousel(user,tenant,brand,carouselId,{revision:2,content:null},correlation)).rejects.toThrow('CONFLICT');
    await expect(service.setCarouselArchived(user,tenant,brand,carouselId,archive,correlation)).rejects.toThrow('CONFLICT');
    await service.editCarousel(user,tenant,brand,carouselId,{revision:2,lifecycleRevision:2,content:null},correlation);expect(await service.authorizeCarouselExport(user,tenant,brand,carouselId,{revision:'2',lifecycleRevision:'2'})).toHaveProperty('version',2);await expect(service.authorizeCarouselExport(user,tenant,brand,carouselId,{revision:'2',lifecycleRevision:'0'})).rejects.toThrow('CONFLICT');
    expect(await service.carouselHistory(user,tenant,brand,carouselId)).toEqual(history);expect((await ledger.overview(user,tenant)).balances).toEqual(before);
    expect(await database.client`select id from audit_logs where resource_id=${carouselId} and action in ('CAROUSEL_ARCHIVED','CAROUSEL_RESTORED')`).toHaveLength(2);
  });
  it('requires a current writer and isolates archive changes by tenant and brand',async()=>{
    const input={revision:2,lifecycleRevision:2,archived:true};
    for(const role of ['VIEWER','CLIENT_APPROVER']){
      await database.client`update organization_members set role=${role} where tenant_id=${tenant} and user_id=${user}`;
      await expect(service.setCarouselArchived(user,tenant,brand,carouselId,input,correlation)).rejects.toThrow('NOT_AUTHORIZED');
    }
    await database.client`update organization_members set role='OWNER' where tenant_id=${tenant} and user_id=${user}`;
    await expect(service.setCarouselArchived(user,tenant,randomUUID(),carouselId,input,correlation)).rejects.toThrow('NOT_FOUND');
    const foreign=randomUUID();await database.client`insert into organizations(id,name) values(${foreign},'Other')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${foreign},${user},'OWNER')`;
    await expect(service.setCarouselArchived(user,foreign,brand,carouselId,input,correlation)).rejects.toThrow('NOT_FOUND');
    await expect(service.carouselHistory(user,foreign,brand,carouselId)).rejects.toThrow('NOT_FOUND');
    expect((await content.overview(user,tenant,brand)).carousels[0]?.lifecycleRevision).toBe(2);
  });
  it('serializes competing archive and edit operations and keeps archived approval empty',async()=>{
    const original=(await service.carouselHistory(user,tenant,brand,carouselId))[0]!.content;
    const results=await Promise.allSettled([
      service.setCarouselArchived(user,tenant,brand,carouselId,{revision:2,lifecycleRevision:2,archived:true},correlation),
      service.editCarousel(user,tenant,brand,carouselId,{revision:2,lifecycleRevision:2,content:{...original,caption:'Concurrent edit'}},correlation),
    ]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const [row]=await database.client`select current_version,lifecycle_revision,archived_at,approved_version from carousels where id=${carouselId}`;
    expect(row!.approved_version).toBeNull();
    if(row!.archived_at)expect(row!.current_version).toBe(2);else expect(row!.current_version).toBe(3);
  });
  it('pages beyond 100 immutable versions without duplicates when newer edits arrive',async()=>{
    const id=randomUUID(),item=randomUUID();
    await database.client`insert into content_items(id,tenant_id,brand_id,title,type,status) values(${item},${tenant},${brand},'History fixture','CAROUSEL','READY')`;
    await database.client`insert into carousels(id,tenant_id,brand_id,content_item_id,current_version,platform) values(${id},${tenant},${brand},${item},105,'TELEGRAM')`;
    await database.client`insert into carousel_versions(tenant_id,carousel_id,version,content,created_by) select ${tenant},${id},n,content,${user} from carousel_versions cross join generate_series(1,105) n where carousel_id=${carouselId} and version=1`;
    const before=(await ledger.overview(user,tenant)).balances;
    const first=await service.carouselHistoryPage(user,tenant,brand,id,{});
    expect(first.items.map(row=>row.version)).toEqual(Array.from({length:20},(_,i)=>105-i));expect(first.nextBefore).toBe(86);
    await service.editCarousel(user,tenant,brand,id,{revision:105,content:{...first.items[0]!.content,caption:'New version during pagination'}},correlation);
    const seen=first.items.map(row=>row.version);let cursor=first.nextBefore;
    while(cursor!==null){const page=await service.carouselHistoryPage(user,tenant,brand,id,{before:String(cursor)});expect(page.items.length).toBeLessThanOrEqual(20);seen.push(...page.items.map(row=>row.version));cursor=page.nextBefore;}
    expect(seen).toEqual(Array.from({length:105},(_,i)=>105-i));
    expect((await service.carouselHistoryPage(user,tenant,brand,id,{})).items[0]?.version).toBe(106);
    expect((await service.carouselHistoryPage(user,tenant,brand,id,{before:'21'})).nextBefore).toBeNull();
    expect(await service.carouselHistoryPage(user,tenant,brand,id,{before:'1'})).toEqual({items:[],nextBefore:null});
    const oldest=(await service.carouselHistoryPage(user,tenant,brand,id,{before:'2'})).items[0]!;
    await service.editCarousel(user,tenant,brand,id,{revision:106,content:oldest.content},correlation);
    const latest=await service.carouselHistoryPage(user,tenant,brand,id,{});expect(latest.items[0]?.version).toBe(107);expect(latest.items[0]?.content).toEqual(oldest.content);expect(latest.items[1]?.content.caption).toBe('New version during pagination');
    expect((await ledger.overview(user,tenant)).balances).toEqual(before);
    await service.setCarouselArchived(user,tenant,brand,id,{revision:107,lifecycleRevision:0,archived:true},correlation);
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${user}`;
    expect((await service.carouselHistoryPage(user,tenant,brand,id,{before:'2'})).items[0]).toEqual(oldest);
    await expect(service.editCarousel(user,tenant,brand,id,{revision:107,lifecycleRevision:1,content:oldest.content},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.carouselHistoryPage(user,tenant,randomUUID(),id,{})).rejects.toThrow('NOT_FOUND');
    await expect(service.carouselHistoryPage(randomUUID(),tenant,brand,id,{})).rejects.toThrow('NOT_FOUND');
    const foreign=randomUUID();await database.client`insert into organizations(id,name) values(${foreign},'History isolation')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${foreign},${user},'OWNER')`;
    await expect(service.carouselHistoryPage(user,foreign,brand,id,{before:'2'})).rejects.toThrow('NOT_FOUND');
    await database.client`update organization_members set role='OWNER' where tenant_id=${tenant} and user_id=${user}`;
  });
  it('rejects invalid script-oriented requests and rechecks disabled accounts before completion',async()=>{
    await expect(service.enqueue(user,tenant,brand,{...input,options:{...input.options,revision:1}},correlation)).rejects.toThrow('INVALID_INPUT');
    const saved=await service.enqueue(user,tenant,brand,{...input,idempotencyKey:randomUUID()},correlation),job=await jobs.claim(tenant,saved.id);
    await database.client`update users set disabled_at=now() where id=${user}`;await expect(service.authorizeCarouselExport(user,tenant,brand,carouselId,{revision:'2',lifecycleRevision:'2'})).rejects.toThrow('NOT_FOUND');
    await expect(service.carouselHistoryPage(user,tenant,brand,carouselId,{})).rejects.toThrow('NOT_FOUND');
    await expect(jobs.complete(tenant,job!.id,job!.leaseToken!,{title:'Carousel',slides:[{heading:'One',body:'Text'},{heading:'Two',body:'Text'}],caption:'Caption',hashtags:[],factCheckNotes:[],design:{format:'SQUARE',font:'SANS',backgroundColor:'#ffffff',textColor:'#000000',accentColor:'#112233'}})).rejects.toThrow();
    await jobs.fail(tenant,job!.id,job!.leaseToken!,'NOT_AUTHORIZED',false);
    expect((await database.client`select status from usage_reservations where id=${job!.reservationId}`)[0]?.status).toBe('RELEASED');
  });
});
