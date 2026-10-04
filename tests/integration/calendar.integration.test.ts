import {randomUUID} from 'node:crypto';
import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {createDatabase,CalendarRepository} from '../../packages/db/src/index';
import {CalendarService} from '../../packages/core/src/calendar';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('tenant content calendar',()=>{
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const database=createDatabase(url??'postgresql://localhost/unused_test'),service=new CalendarService(new CalendarRepository(database.db));
  const tenantId=randomUUID(),brandId=randomUUID(),workspaceId=randomUUID(),owner=randomUUID(),viewer=randomUUID(),correlation=randomUUID();
  const input=()=>({title:'Тестовый материал',type:'POST',platform:'TELEGRAM',localDateTime:'2026-10-04T12:30',timeZone:'Europe/Moscow',caption:'Текст',hashtags:['контент'],idempotencyKey:randomUUID()});
  const window={from:'2026-10-01T00:00:00Z',to:'2026-11-01T00:00:00Z'};
  beforeAll(async()=>{
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${owner},${`calendar-${owner}@example.test`},'unusable','Owner',now()),(${viewer},${`calendar-${viewer}@example.test`},'unusable','Viewer',now())`;
    await database.client`insert into organizations(id,name) values(${tenantId},'Calendar tests')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${owner},'OWNER'),(${tenantId},${viewer},'VIEWER')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspaceId},${tenantId},'Fixture')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brandId},${tenantId},${workspaceId},'Fixture')`;
  });
  afterAll(()=>database.close());
  it('authorizes brand ownership and returns an idempotent UTC plan, without publishing a job',async()=>{
    const data=input();await expect(service.create(viewer,tenantId,brandId,data,correlation)).rejects.toThrow('NOT_AUTHORIZED');await expect(service.create(owner,tenantId,randomUUID(),data,correlation)).rejects.toThrow('NOT_FOUND');
    const entry=await service.create(owner,tenantId,brandId,data,correlation);expect(await service.create(owner,tenantId,brandId,data,correlation)).toEqual(entry);
    await expect(service.create(owner,tenantId,brandId,{...data,title:'Changed'},correlation)).rejects.toThrow('CONFLICT');
    const rows=await service.list(viewer,tenantId,brandId,window);expect(rows).toHaveLength(1);expect(rows[0]?.plannedAt.toISOString()).toBe('2026-10-04T09:30:00.000Z');expect(rows[0]?.publishingMode).toBe('APPROVAL');expect(rows[0]?.contentStatus).toBe('IDEA');
    expect(JSON.stringify(rows)).not.toContain('inputHash');expect(await database.client`select id from jobs where tenant_id=${tenantId}`).toHaveLength(0);
    await expect(service.list(randomUUID(),tenantId,brandId,window)).rejects.toThrow('NOT_FOUND');
  });
  it('preserves optimistic concurrency, prevents invalid video attachment and audits cancellation',async()=>{
    const {idempotencyKey:_key,...fields}=input();const entry=await service.create(owner,tenantId,brandId,input(),correlation);
    await expect(service.update(owner,tenantId,brandId,entry.id,{...fields,revision:0,videoProjectId:randomUUID()},correlation)).rejects.toThrow('INVALID_INPUT');
    await expect(service.update(owner,tenantId,brandId,entry.id,{...fields,type:'SHORT_VIDEO',revision:0,videoProjectId:randomUUID()},correlation)).rejects.toThrow('NOT_FOUND');
    const results=await Promise.allSettled([service.update(owner,tenantId,brandId,entry.id,{...fields,revision:0,localDateTime:'2026-10-05T14:00'},correlation),service.update(owner,tenantId,brandId,entry.id,{...fields,revision:0,localDateTime:'2026-10-06T14:00'},correlation)]);
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    await expect(service.cancel(viewer,tenantId,brandId,entry.id,{revision:1},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.cancel(owner,tenantId,brandId,entry.id,{revision:0},correlation)).rejects.toThrow('CONFLICT');
    await service.cancel(owner,tenantId,brandId,entry.id,{revision:1},correlation);await service.cancel(owner,tenantId,brandId,entry.id,{revision:1},correlation);
    expect((await service.list(owner,tenantId,brandId,window)).some(row=>row.id===entry.id)).toBe(false);
    expect(await database.client`select id from audit_logs where resource_id=${entry.id} and action='CALENDAR_ENTRY_CANCELLED'`).toHaveLength(1);
  });
});
