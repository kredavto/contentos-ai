import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { FunnelRepository, UtmRepository } from '../../packages/db/src/index';
import { FunnelService } from '../../packages/core/src/funnels';
import { UtmService } from '../../packages/core/src/utm';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('content CTA funnels and manual measurement evidence',()=>{
  const database=isolatedTestDatabase(url),service=new FunnelService(new FunnelRepository(database.db)),utm=new UtmService(new UtmRepository(database.db));
  const user=randomUUID(),editor=randomUUID(),viewer=randomUUID(),outsider=randomUUID(),tenant=randomUUID(),foreignTenant=randomUUID(),brand=randomUUID(),sibling=randomUUID(),foreignBrand=randomUUID(),content=randomUUID(),siblingContent=randomUUID(),foreignContent=randomUUID(),correlation=randomUUID();
  let link='',siblingLink='',target='';
  const creationKey=randomUUID(),reportKey=randomUUID();
  const report={from:'2026-10-01T00:00:00.000Z',to:'2026-10-02T00:00:00.000Z',clicks:100,leads:null,source:'Fixture analytics export',expectedVersion:0,idempotencyKey:reportKey};
  beforeAll(async()=>{
    for(const id of [user,editor,viewer,outsider])await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Funnel fixture','unusable',now())`;
    for(const id of [tenant,foreignTenant]){await database.client`insert into organizations(id,name) values(${id},'Funnel tenant')`;await database.client`insert into workspaces(id,tenant_id,name) values(${id},${id},'Workspace')`;}
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${user},'OWNER'),(${tenant},${editor},'EDITOR'),(${tenant},${viewer},'VIEWER'),(${foreignTenant},${outsider},'OWNER')`;
    for(const [id,tenantId] of [[brand,tenant],[sibling,tenant],[foreignBrand,foreignTenant]] as const)await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${id},${tenantId},${tenantId},'Funnel brand')`;
    for(const [id,brandId,tenantId] of [[content,brand,tenant],[siblingContent,sibling,tenant],[foreignContent,foreignBrand,foreignTenant]] as const)await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${id},${tenantId},${brandId},'Campaign post','POST')`;
    for(const [brandId,set] of [[brand,(id:string)=>{link=id;}],[sibling,(id:string)=>{siblingLink=id;}]] as const)set((await utm.create(user,tenant,brandId,{name:'Campaign link',destinationUrl:'https://example.com',source:'telegram',medium:'social',campaign:'autumn',idempotencyKey:randomUUID()},correlation)).id);
  });
  const input=()=>({contentItemId:content,utmLinkId:link,cta:'Read the course',destinationType:'WEBSITE',idempotencyKey:creationKey});
  it('creates once, retains actor-bound intent, and isolates source choices',async()=>{
    const saved=await Promise.all([service.create(user,tenant,brand,input(),correlation),service.create(user,tenant,brand,input(),correlation)]);expect(saved[0]).toEqual(saved[1]);target=saved[0]!.id;
    await expect(service.create(editor,tenant,brand,input(),correlation)).rejects.toThrow('CONFLICT');
    await expect(service.create(user,tenant,brand,{...input(),cta:'Changed'},correlation)).rejects.toThrow('CONFLICT');
    expect((await service.choices(viewer,tenant,brand,{kind:'CONTENT'})).rows.map(row=>row.id)).toEqual([content]);
    expect((await service.choices(user,tenant,brand,{kind:'LINK',search:'Campaign'})).rows.map(row=>row.id)).toEqual([link]);
    expect((await service.choices(user,tenant,brand,{kind:'LINK',search:'%'})).rows).toEqual([]);
    await expect(service.list(outsider,tenant,brand,{})).rejects.toThrow('NOT_FOUND');
    expect((await service.list(viewer,tenant,sibling,{})).rows).toEqual([]);
  });
  it('rejects foreign/sibling sources in both service and database, and denies viewer writes',async()=>{
    await expect(service.create(viewer,tenant,brand,{...input(),idempotencyKey:randomUUID()},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    for(const patch of [{contentItemId:siblingContent},{contentItemId:foreignContent},{utmLinkId:siblingLink}])await expect(service.create(user,tenant,brand,{...input(),...patch,idempotencyKey:randomUUID()},correlation)).rejects.toThrow('NOT_FOUND');
    await expect(database.client`insert into funnel_targets(tenant_id,brand_id,content_item_id,utm_link_id,cta,destination_type,created_by,idempotency_key,input_hash) values(${tenant},${brand},${siblingContent},${link},'Invalid','URL',${user},${randomUUID()},'fixture')`).rejects.toThrow();
    await expect(database.client`update funnel_targets set cta='Changed' where id=${target}`).rejects.toThrow();
  });
  it('records one manual version on concurrent retry and preserves unknown versus zero',async()=>{
    await expect(service.measure(editor,tenant,brand,target,report,correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.measure(user,tenant,sibling,target,report,correlation)).rejects.toThrow('NOT_FOUND');
    const saved=await Promise.all([service.measure(user,tenant,brand,target,report,correlation),service.measure(user,tenant,brand,target,report,correlation)]);expect(saved[0]).toEqual(saved[1]);expect(saved[0]!.leads).toBeNull();
    await expect(service.measure(user,tenant,brand,target,{...report,leads:0},correlation)).rejects.toThrow('CONFLICT');
    const correction=await service.measure(user,tenant,brand,target,{...report,clicks:120,leads:0,expectedVersion:1,idempotencyKey:randomUUID()},correlation);expect(correction.version).toBe(2);expect(correction.leads).toBe(0);
    const history=await service.measurements(viewer,tenant,brand,target,{});expect(history.rows).toHaveLength(2);expect(history.rows.every(row=>row.currentVersion===2)).toBe(true);expect(history.rows.find(row=>row.version===1)?.leads).toBeNull();
    expect(JSON.stringify(history)).not.toMatch(/inputHash|createdBy|idempotencyKey/);
    await expect(database.client`update funnel_measurements set clicks=5 where id=${correction.id}`).rejects.toThrow();
    await expect(database.client`delete from funnel_measurements where id=${correction.id}`).rejects.toThrow();
    const audit=await database.client`select metadata from audit_logs where action='FUNNEL_MEASUREMENT_RECORDED'`;expect(audit).toHaveLength(2);expect(audit.map(row=>row.metadata)).toEqual([{version:1},{version:2}]);
  });
  it('fences conflicting corrections and validates evidence windows without fabricating values',async()=>{
    const results=await Promise.allSettled([1,2].map(leads=>service.measure(user,tenant,brand,target,{...report,leads,expectedVersion:2,idempotencyKey:randomUUID()},correlation)));expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
    for(const patch of [{clicks:null,leads:null},{clicks:-1},{to:'2026-10-01T00:00:00.000Z'},{to:'2099-01-01T00:00:00.000Z'},{source:' '},{from:'2099-01-01T00:00:00.000Z',to:'2099-01-02T00:00:00.000Z'}])expect(()=>service.measure(user,tenant,brand,target,{...report,...patch,idempotencyKey:randomUUID()},correlation)).toThrow();
    expect((await service.measurements(viewer,tenant,brand,target,{})).rows).toHaveLength(3);
  });
  it('keeps historical links readable after archiving and rechecks revoked membership on replay',async()=>{
    await utm.archive(user,tenant,brand,link,{revision:0,archived:true},correlation);
    expect((await service.choices(user,tenant,brand,{kind:'LINK'})).rows).toEqual([]);
    expect((await service.list(viewer,tenant,brand,{})).rows[0]?.linkArchivedAt).not.toBeNull();
    await expect(service.create(user,tenant,brand,{...input(),idempotencyKey:randomUUID()},correlation)).rejects.toThrow('NOT_FOUND');
    expect((await service.create(user,tenant,brand,input(),correlation)).id).toBe(target);
    await database.client`delete from organization_members where tenant_id=${tenant} and user_id=${user}`;
    await expect(service.measure(user,tenant,brand,target,report,correlation)).rejects.toThrow('NOT_FOUND');
  });
});
