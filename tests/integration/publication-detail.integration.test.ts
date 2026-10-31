import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {PublishingRepository} from '../../packages/db/src/index';
import {PublishingService} from '../../packages/core/src/publishing';
import {isolatedTestDatabase} from '../helpers/isolated-database';
import {publicationDetailFixture} from '../helpers/publication-detail-fixture';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('exact stored publication detail',()=>{
  const database=isolatedTestDatabase(url),repository=new PublishingRepository(database.db),service=new PublishingService(repository,null,false);
  it('reads exact evidence beyond the overview cap without raw snapshots, references or state changes',async()=>{
    const f=await publicationDetailFixture(database.client),overview=await repository.list(f.user,f.tenant,f.brand);
    expect(overview).toHaveLength(100);expect(overview.some(row=>row.id===f.job)).toBe(false);
    const row=await service.publication(f.user,f.tenant,f.brand,f.publication);
    expect(row).toMatchObject({id:f.publication,brandId:f.brand,title:f.title,contentTitle:f.contentTitle,caption:f.caption,privacy:'PRIVATE',commentsEnabled:false,timeZone:'Europe/Moscow',provider:'telegram',status:'PUBLISHED',role:'VIEWER'});
    expect(row.publishedAt.toISOString()).toBe('2025-01-01T12:01:00.000Z');
    for(const key of ['snapshot','reference','url','connectionId','jobId','finalKey','credential'])expect(row).not.toHaveProperty(key);
    expect(JSON.stringify(row)).not.toContain(f.privateMarker);
    await database.client`update content_items set title='Renamed current material' where id=${f.content}`;
    expect(await service.publication(f.user,f.tenant,f.brand,f.publication)).toMatchObject({title:f.title,caption:f.caption,contentTitle:'Renamed current material'});
    expect(await database.client`select id from publications where tenant_id=${f.tenant}`).toHaveLength(102);
    expect(await database.client`select id from publishing_jobs where tenant_id=${f.tenant} and status<>'PUBLISHED'`).toHaveLength(0);
    expect(await database.client`select id from audit_logs where tenant_id=${f.tenant}`).toHaveLength(0);
  });
  it('rejects wrong tenant/brand/account, missing publication and job IDs without substitution',async()=>{
    const f=await publicationDetailFixture(database.client);
    for(const args of [[f.user,f.tenant,f.otherBrand,f.publication],[f.user,f.foreign,f.foreign,f.publication],[f.outsider,f.tenant,f.brand,f.publication],[f.user,f.tenant,f.brand,f.otherBrand],[f.user,f.tenant,f.brand,f.job]])await expect(service.publication(...args as [string,string,string,string])).rejects.toThrow('NOT_FOUND');
    expect(()=>service.publication(f.user,f.tenant,f.brand,'invalid')).toThrow();
  });
  it('rejects inconsistent cross-brand content links even where legacy foreign keys permit them',async()=>{
    const f=await publicationDetailFixture(database.client),content=randomUUID(),job=randomUUID(),publication=randomUUID();
    await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${content},${f.tenant},${f.otherBrand},'Other brand private content','POST')`;
    await database.client`insert into publishing_jobs(id,tenant_id,brand_id,calendar_id,calendar_revision,content_item_id,connection_id,credential_version,provider,snapshot,status,scheduled_at,next_attempt_at,idempotency_key,input_hash,approved_by,correlation_id) select ${job},tenant_id,brand_id,calendar_id,999,${content},connection_id,credential_version,provider,snapshot,'PUBLISHED',scheduled_at,next_attempt_at,${randomUUID()},'fixture',approved_by,${randomUUID()} from publishing_jobs where id=${f.job}`;
    await database.client`insert into publications(id,tenant_id,job_id,provider,reference,published_at) values(${publication},${f.tenant},${job},'telegram',${JSON.stringify({provider:'telegram',internalId:job,externalId:'fixture'})}::jsonb,now())`;
    await expect(service.publication(f.user,f.tenant,f.brand,publication)).rejects.toThrow('NOT_FOUND');
    await expect(service.publication(f.user,f.tenant,f.otherBrand,publication)).rejects.toThrow('NOT_FOUND');
  });
  it('rechecks revoked membership and disabled accounts on every read',async()=>{
    const f=await publicationDetailFixture(database.client);await service.publication(f.user,f.tenant,f.brand,f.publication);
    await database.client`delete from organization_members where tenant_id=${f.tenant} and user_id=${f.user}`;
    await expect(service.publication(f.user,f.tenant,f.brand,f.publication)).rejects.toThrow('NOT_FOUND');
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${f.tenant},${f.user},'VIEWER')`;
    await database.client`update users set disabled_at=now() where id=${f.user}`;
    await expect(service.publication(f.user,f.tenant,f.brand,f.publication)).rejects.toThrow('NOT_FOUND');
  });
});
