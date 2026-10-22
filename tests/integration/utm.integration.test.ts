import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { UtmRepository } from '../../packages/db/src/index';
import { UtmService } from '../../packages/core/src/utm';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('tenant-owned UTM links', () => {
  const database = isolatedTestDatabase(url), service = new UtmService(new UtmRepository(database.db));
  const user = randomUUID(), viewer = randomUUID(), outsider = randomUUID(), tenant = randomUUID(), foreignTenant = randomUUID(), brand = randomUUID(), foreignBrand = randomUUID(), sibling = randomUUID();
  const correlation = randomUUID(), key = randomUUID();
  const input = { name: 'Campaign', destinationUrl: 'https://example.com/?utm_source=old#cta', source: 'telegram', medium: 'social', campaign: 'launch', idempotencyKey: key };
  let linkId = '';
  beforeAll(async () => {
    for (const id of [user,viewer,outsider]) await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'UTM fixture','unusable',now())`;
    for (const id of [tenant,foreignTenant]) { await database.client`insert into organizations(id,name) values(${id},'UTM tenant')`; await database.client`insert into workspaces(id,tenant_id,name) values(${id},${id},'Workspace')`; }
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${user},'EDITOR'),(${tenant},${viewer},'VIEWER'),(${foreignTenant},${outsider},'OWNER')`;
    for (const [id,tenantId] of [[brand,tenant],[sibling,tenant],[foreignBrand,foreignTenant]]) await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${id!},${tenantId!},${tenantId!},'UTM brand')`;
  });
  it('deduplicates concurrent saves, rejects changed replay and returns no internal hash/key/actor', async () => {
    const saved = await Promise.all([service.create(user,tenant,brand,input,correlation),service.create(user,tenant,brand,input,correlation)]);
    expect(saved[0]).toEqual(saved[1]); linkId = saved[0]!.id;
    expect(new URL(saved[0]!.taggedUrl).searchParams.get('utm_source')).toBe('telegram');
    await expect(service.create(user,tenant,brand,{...input,campaign:'other'},correlation)).rejects.toThrow('CONFLICT');
    await expect(service.create(user,tenant,sibling,input,correlation)).rejects.toThrow('CONFLICT');
    const list = await service.list(viewer,tenant,brand,{}); expect(list.rows).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/inputHash|idempotencyKey|createdBy/);
    const audit = await database.client`select metadata from audit_logs where action='UTM_LINK_CREATED'`;
    expect(audit).toHaveLength(1); expect(audit[0]!.metadata).toEqual({});
  });
  it('enforces roles, verified accounts, tenant and brand isolation', async () => {
    await expect(service.create(viewer,tenant,brand,input,correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.list(outsider,tenant,brand,{})).rejects.toThrow('NOT_FOUND');
    await expect(service.list(user,tenant,foreignBrand,{})).rejects.toThrow('NOT_FOUND');
    expect((await service.list(user,tenant,sibling,{})).rows).toEqual([]);
    await expect(service.archive(user,tenant,sibling,linkId,{revision:0,archived:true},correlation)).rejects.toThrow('NOT_FOUND');
    await database.client`update users set email_verified_at=null where id=${user}`;
    await expect(service.create(user,tenant,brand,{...input,idempotencyKey:randomUUID()},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set email_verified_at=now() where id=${user}`;
  });
  it('archives without changing destination and preserves retry results without resurrection', async () => {
    await expect(service.archive(user,tenant,brand,linkId,{revision:9,archived:true},correlation)).rejects.toThrow('CONFLICT');
    const archived = await service.archive(user,tenant,brand,linkId,{revision:0,archived:true},correlation);
    expect(archived.revision).toBe(1); expect(archived.archivedAt).not.toBeNull();
    expect(await service.archive(user,tenant,brand,linkId,{revision:0,archived:true},correlation)).toEqual(archived);
    expect((await service.create(user,tenant,brand,input,correlation)).archivedAt).not.toBeNull();
    expect((await service.list(user,tenant,brand,{})).rows).toEqual([]);
    expect((await service.list(user,tenant,brand,{status:'ARCHIVED'})).rows).toHaveLength(1);
    const restored = await service.archive(user,tenant,brand,linkId,{revision:1,archived:false},correlation);
    expect(restored.taggedUrl).toBe(archived.taggedUrl); expect(restored.revision).toBe(2);
  });
  it('searches name, campaign and source literally within the current brand and archive state', async () => {
    const searchBrand=randomUUID();await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${searchBrand},${tenant},${tenant},'Search fixture')`;
    const named=await service.create(user,tenant,searchBrand,{...input,name:'Осенний запуск',campaign:'september',idempotencyKey:randomUUID()},correlation);
    const campaign=await service.create(user,tenant,searchBrand,{...input,name:'Other',campaign:'50%_Launch',source:String.raw`path\draft`,idempotencyKey:randomUUID()},correlation);
    const ids=async(search:string,status='ACTIVE')=>(await service.list(viewer,tenant,searchBrand,{search,status})).rows.map(row=>row.id);
    expect(await ids('осенний')).toEqual([named.id]);expect(await ids('SEPTEMBER')).toEqual([named.id]);
    expect(await ids('%_')).toEqual([campaign.id]);expect(await ids(String.raw`\draft`)).toEqual([campaign.id]);
    expect(await ids("' OR true --")).toEqual([]);expect(await ids('no-match')).toEqual([]);
    expect((await service.list(user,tenant,brand,{search:'50%_Launch'})).rows).toEqual([]);
    await expect(service.list(outsider,tenant,searchBrand,{search:'Launch'})).rejects.toThrow('NOT_FOUND');
    await expect(service.list(user,foreignTenant,searchBrand,{search:'Launch'})).rejects.toThrow('NOT_FOUND');
    await service.archive(user,tenant,searchBrand,campaign.id,{revision:0,archived:true},correlation);
    expect(await ids('%_')).toEqual([]);expect(await ids('%_','ARCHIVED')).toEqual([campaign.id]);
    expect((await service.list(viewer,tenant,searchBrand,{search:''})).rows.map(row=>row.id)).toEqual([named.id]);
  });
  it('paginates filtered matches without duplicates or nonmatching rows', async () => {
    const searchBrand=randomUUID();await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${searchBrand},${tenant},${tenant},'Search pages')`;
    for(let i=0;i<52;i++)await service.create(user,tenant,searchBrand,{...input,name:`Search ${i}`,campaign:'winter_match',idempotencyKey:randomUUID()},correlation);
    await service.create(user,tenant,searchBrand,{...input,name:'Unrelated',campaign:'other',idempotencyKey:randomUUID()},correlation);
    const first=await service.list(viewer,tenant,searchBrand,{search:'WINTER_'}),next=await service.list(viewer,tenant,searchBrand,{search:'WINTER_',before:first.nextCursor});
    expect(first.rows).toHaveLength(50);expect(next.rows).toHaveLength(2);expect(next.nextCursor).toBeNull();
    expect(new Set([...first.rows,...next.rows].map(row=>row.id)).size).toBe(52);
    expect([...first.rows,...next.rows].every(row=>row.campaign==='winter_match')).toBe(true);
    await database.client`update users set disabled_at=now() where id=${viewer}`;
    await expect(service.list(viewer,tenant,searchBrand,{search:'WINTER_'})).rejects.toThrow('NOT_FOUND');
    await database.client`update users set disabled_at=null where id=${viewer}`;
  });
  it('paginates without duplicates and fences revoked membership even for an idempotent replay', async () => {
    for (let i=0;i<52;i++) await service.create(user,tenant,brand,{...input,name:`Page ${i}`,idempotencyKey:randomUUID()},correlation);
    const first = await service.list(user,tenant,brand,{}); expect(first.rows).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
    const next = await service.list(user,tenant,brand,{before:first.nextCursor}); expect(next.rows).toHaveLength(3); expect(next.nextCursor).toBeNull();
    expect(new Set([...first.rows,...next.rows].map(row=>row.id)).size).toBe(53);
    await database.client`delete from organization_members where tenant_id=${tenant} and user_id=${user}`;
    await expect(service.create(user,tenant,brand,input,correlation)).rejects.toThrow('NOT_FOUND');
  });
});
