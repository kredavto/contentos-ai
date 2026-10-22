import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { BillingRepository, NotificationRepository, PaymentTaskRepository } from '../../packages/db/src/index';
import { NotificationService } from '../../packages/core/src/notifications';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable role-scoped notifications',()=>{
  const database=isolatedTestDatabase(url),repository=new NotificationRepository(database.db),service=new NotificationService(repository),billing=new BillingRepository(database.db);
  const merchant={provider:'yookassa' as const,merchantId:'100500',test:true},version=randomUUID();
  beforeAll(async()=>{const [plan]=await database.client`update plans set enabled=true where code='START' returning id`;await database.client`insert into plan_versions(id,plan_id,version,amount_minor,ai_credits,video_seconds) values(${version},${plan!.id},1,10000,10,20)`;});
  async function fixture(){
    const tenantId=randomUUID(),owner=randomUUID(),otherOwner=randomUUID(),editor=randomUUID(),viewer=randomUUID(),approver=randomUUID(),brandId=randomUUID(),workspace=randomUUID();
    await database.client`insert into organizations(id,name) values(${tenantId},'Notification fixture')`;
    for(const [id,role] of [[owner,'OWNER'],[otherOwner,'OWNER'],[editor,'EDITOR'],[viewer,'VIEWER'],[approver,'CLIENT_APPROVER']]){
      await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${id!},${`notice-${id}@example.test`},'unusable','Fixture',now())`;
      await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenantId},${id!},${role!})`;
    }
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenantId},'Fixture')`;await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brandId},${tenantId},${workspace},'Fixture')`;
    const buy=()=>billing.checkout(owner,tenantId,version,randomUUID(),{returnUrl:'https://contentos.example/billing',receipt:{customerEmail:'notice@example.test',vatCode:11,subject:'service',mode:'full_payment'}},merchant,randomUUID());
    const pay=async()=>{const order=await buy();await billing.settle(tenantId,order.id,{...merchant,externalId:randomUUID(),internalId:order.id,amountMinor:10000,currency:'RUB',status:'SUCCEEDED',paid:true});return order;};
    return {tenantId,owner,otherOwner,editor,viewer,approver,brandId,buy,pay};
  }
  it('projects a paid event once per recipient and never exposes payment details',async()=>{
    const f=await fixture();await f.pay();await Promise.all([repository.projectBatch(f.tenantId),repository.projectBatch(f.tenantId)]);await repository.projectBatch(f.tenantId);
    const feed=await service.list(f.owner,f.tenantId,{});expect(feed.items).toHaveLength(1);expect(feed.items[0]!.type).toBe('PAYMENT_SUCCESS');expect(feed.unread).toBe(1);expect(feed.items[0]!.href).toBe(`/billing?organization=${f.tenantId}`);
    expect((await service.list(f.otherOwner,f.tenantId,{})).items).toHaveLength(1);expect((await service.list(f.viewer,f.tenantId,{})).items).toHaveLength(0);
    expect(JSON.stringify(feed)).not.toContain('100500');expect(JSON.stringify(feed)).not.toContain('@example.test');
    await expect(database.client`update notification_receipts set source_key='changed' where tenant_id=${f.tenantId}`).rejects.toThrow();
  });
  it('keeps first-read idempotent and rechecks recipient, tenant and current role',async()=>{
    const f=await fixture();await f.pay();await repository.projectBatch(f.tenantId);const item=(await service.list(f.owner,f.tenantId,{})).items[0]!;
    const read=await service.markRead(f.owner,f.tenantId,{id:item.id});expect(await service.markRead(f.owner,f.tenantId,{id:item.id})).toEqual(read);expect((await service.list(f.owner,f.tenantId,{})).unread).toBe(0);
    await expect(service.markRead(f.otherOwner,f.tenantId,{id:item.id})).rejects.toThrow('NOT_FOUND');
    const other=await fixture();await expect(service.list(f.owner,other.tenantId,{})).rejects.toThrow('NOT_FOUND');
    await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenantId} and user_id=${f.owner}`;
    expect((await service.list(f.owner,f.tenantId,{})).items).toHaveLength(0);await expect(service.markRead(f.owner,f.tenantId,{id:item.id})).rejects.toThrow('NOT_FOUND');
    await expect(database.client`update notifications set type='JOB_FAILED' where id=${item.id}`).rejects.toThrow('Notification identity');
  });
  it('marks only the requested snapshot and preserves first-read timestamps on retry',async()=>{
    const f=await fixture();
    await database.client`insert into notifications(tenant_id,user_id,source_key,type,audience,resource_id) select ${f.tenantId},${f.owner},'batch:'||n,'JOB_FAILED','ALL',${randomUUID()} from generate_series(1,51) n`;
    const first=await service.list(f.owner,f.tenantId,{}),ids=first.items.map(item=>item.id);
    const already=await service.markRead(f.owner,f.tenantId,{id:ids[0]});
    const late=randomUUID();await database.client`insert into notifications(id,tenant_id,user_id,source_key,type,audience,resource_id) values(${late},${f.tenantId},${f.owner},${late},'JOB_FAILED','ALL',${randomUUID()})`;
    const result=await service.markReadBatch(f.owner,f.tenantId,{ids});expect(result.items).toHaveLength(50);expect(result.unread).toBe(2);
    expect(result.items.find(item=>item.id===ids[0])?.readAt).toEqual(already.readAt);
    const replay=await service.markReadBatch(f.owner,f.tenantId,{ids:[...ids].reverse()});
    expect(new Map(replay.items.map(item=>[item.id,item.readAt]))).toEqual(new Map(result.items.map(item=>[item.id,item.readAt])));expect(replay.unread).toBe(2);
    expect((await database.client`select read_at from notifications where id=${late}`)[0]?.read_at).toBeNull();
  });
  it('rejects a mixed unauthorized batch atomically and rechecks current roles and accounts',async()=>{
    const f=await fixture();await f.pay();await repository.projectBatch(f.tenantId);
    const own=(await service.list(f.owner,f.tenantId,{})).items[0]!,other=(await service.list(f.otherOwner,f.tenantId,{})).items[0]!;
    for(const id of [other.id,randomUUID()])await expect(service.markReadBatch(f.owner,f.tenantId,{ids:[own.id,id]})).rejects.toThrow('NOT_FOUND');
    expect((await service.list(f.owner,f.tenantId,{})).unread).toBe(1);
    const foreign=await fixture();await database.client`insert into organization_members(tenant_id,user_id,role) values(${foreign.tenantId},${f.owner},'OWNER')`;
    await expect(service.markReadBatch(f.owner,foreign.tenantId,{ids:[own.id]})).rejects.toThrow('NOT_FOUND');
    await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenantId} and user_id=${f.owner}`;
    await expect(service.markReadBatch(f.owner,f.tenantId,{ids:[own.id]})).rejects.toThrow('NOT_FOUND');
    await database.client`update organization_members set role='OWNER' where tenant_id=${f.tenantId} and user_id=${f.owner}`;
    await database.client`update users set disabled_at=now() where id=${f.owner}`;
    await expect(service.markReadBatch(f.owner,f.tenantId,{ids:[own.id]})).rejects.toThrow('NOT_FOUND');
    expect((await database.client`select read_at from notifications where id=${own.id}`)[0]?.read_at).toBeNull();
  });
  it('serializes overlapping batches without deadlocks or changing the first read time',async()=>{
    const f=await fixture();await database.client`insert into notifications(tenant_id,user_id,source_key,type,audience,resource_id) select ${f.tenantId},${f.viewer},'overlap:'||n,'JOB_FAILED','ALL',${randomUUID()} from generate_series(1,3) n`;
    const ids=(await service.list(f.viewer,f.tenantId,{})).items.map(item=>item.id);
    const results=await Promise.all([service.markReadBatch(f.viewer,f.tenantId,{ids}),service.markReadBatch(f.viewer,f.tenantId,{ids:[...ids].reverse()})]);
    expect(results.every(result=>result.unread===0)).toBe(true);
    expect(new Map(results[0]!.items.map(item=>[item.id,item.readAt]))).toEqual(new Map(results[1]!.items.map(item=>[item.id,item.readAt])));
  });
  it('paginates identical database timestamps without skipping or repeating rows',async()=>{
    const f=await fixture();await database.client`insert into notifications(tenant_id,user_id,source_key,type,audience,resource_id) select ${f.tenantId},${f.owner},'fixture:'||n,'JOB_FAILED','ALL',${randomUUID()} from generate_series(1,121) n`;
    const first=await service.list(f.owner,f.tenantId,{}),second=await service.list(f.owner,f.tenantId,{cursor:first.nextCursor}),third=await service.list(f.owner,f.tenantId,{cursor:second.nextCursor});
    expect([first.items.length,second.items.length,third.items.length]).toEqual([50,50,21]);expect(new Set([...first.items,...second.items,...third.items].map(item=>item.id)).size).toBe(121);expect(third.nextCursor).toBeNull();expect(first.unread).toBe(121);
  });
  it('paginates unread events past read rows and accepts a cursor after marking its page read',async()=>{
    const f=await fixture();await database.client`insert into notifications(tenant_id,user_id,source_key,type,audience,resource_id) select ${f.tenantId},${f.owner},'filtered:'||n,'JOB_FAILED','ALL',${randomUUID()} from generate_series(1,121) n`;
    const newest=await service.list(f.owner,f.tenantId,{});await service.markReadBatch(f.owner,f.tenantId,{ids:newest.items.map(item=>item.id)});
    const first=await service.list(f.owner,f.tenantId,{status:'UNREAD'});expect(first.items).toHaveLength(50);expect(first.unread).toBe(71);expect(first.items.every(item=>!item.readAt)).toBe(true);
    expect(first.items.some(item=>newest.items.some(read=>read.id===item.id))).toBe(false);
    await service.markReadBatch(f.owner,f.tenantId,{ids:first.items.map(item=>item.id)});
    const late=randomUUID();await database.client`insert into notifications(id,tenant_id,user_id,source_key,type,audience,resource_id) values(${late},${f.tenantId},${f.owner},${late},'JOB_FAILED','ALL',${randomUUID()})`;
    const second=await service.list(f.owner,f.tenantId,{status:'UNREAD',cursor:first.nextCursor});expect(second.items).toHaveLength(21);expect(second.nextCursor).toBeNull();expect(second.unread).toBe(22);
    expect(new Set([...first.items,...second.items].map(item=>item.id)).size).toBe(71);expect(second.items.some(item=>item.id===late)).toBe(false);
    await service.markReadBatch(f.owner,f.tenantId,{ids:second.items.map(item=>item.id)});
    const refreshed=await service.list(f.owner,f.tenantId,{status:'UNREAD'});expect(refreshed.items.map(item=>item.id)).toEqual([late]);
    await service.markRead(f.owner,f.tenantId,{id:late});expect((await service.list(f.owner,f.tenantId,{status:'UNREAD'})).items).toEqual([]);
    expect((await service.list(f.owner,f.tenantId,{})).items).toHaveLength(50);
  });
  it('rejects unread cursors from other recipients, tenants and no-longer-visible audiences',async()=>{
    const f=await fixture();await f.pay();await repository.projectBatch(f.tenantId);const own=(await service.list(f.owner,f.tenantId,{})).items[0]!;
    await expect(service.list(f.otherOwner,f.tenantId,{status:'UNREAD',cursor:own.id})).rejects.toThrow('NOT_FOUND');
    const other=await fixture();await database.client`insert into organization_members(tenant_id,user_id,role) values(${other.tenantId},${f.owner},'OWNER')`;
    await expect(service.list(f.owner,other.tenantId,{status:'UNREAD',cursor:own.id})).rejects.toThrow('NOT_FOUND');
    await database.client`update organization_members set role='VIEWER' where tenant_id=${f.tenantId} and user_id=${f.owner}`;
    expect((await service.list(f.owner,f.tenantId,{status:'UNREAD'})).unread).toBe(0);
    await expect(service.list(f.owner,f.tenantId,{status:'UNREAD',cursor:own.id})).rejects.toThrow('NOT_FOUND');
    await database.client`delete from organization_members where tenant_id=${f.tenantId} and user_id=${f.owner}`;
    await expect(service.list(f.owner,f.tenantId,{status:'UNREAD'})).rejects.toThrow('NOT_FOUND');
  });
  it('reports a definitive payment rejection once and avoids classifying unsent cancellation as failure',async()=>{
    const f=await fixture(),order=await f.buy(),tasks=new PaymentTaskRepository(database.db),claimed=await tasks.claim(f.tenantId,order.id);await tasks.prepare(f.tenantId,order.id,claimed!.leaseToken!,merchant);await tasks.fail(f.tenantId,order.id,claimed!.leaseToken!,true);
    const canceled=await f.buy();await database.client`update payment_tasks set status='CANCELED' where id=${canceled.id}`;
    await repository.projectBatch(f.tenantId);await repository.projectBatch(f.tenantId);const feed=await service.list(f.owner,f.tenantId,{});expect(feed.items).toHaveLength(1);expect(feed.items[0]!.type).toBe('PAYMENT_FAILED');
  });
  it('warns once before the last paid term expires and excludes prepaid earlier periods',async()=>{
    const f=await fixture();await f.pay();const term=(await billing.overview(f.owner,f.tenantId)).current!;const clock=()=>new Date(term.endsAt.getTime()-2*86400000),projector=new NotificationRepository(database.db,clock);
    await projector.projectBatch(f.tenantId);await projector.projectBatch(f.tenantId);expect((await service.list(f.owner,f.tenantId,{})).items.filter(item=>item.type==='SUBSCRIPTION_EXPIRING')).toHaveLength(1);
    const g=await fixture();await g.pay();await g.pay();await projector.projectBatch(g.tenantId);expect((await service.list(g.owner,g.tenantId,{})).items.some(item=>item.type==='SUBSCRIPTION_EXPIRING')).toBe(false);
  });
  it('warns owners once per latest resource grant, counts reservations and does not invent unfunded budgets',async()=>{
    const f=await fixture();await repository.projectBatch(f.tenantId);
    expect((await service.list(f.owner,f.tenantId,{})).items).toHaveLength(0);
    const grant=async(unit:string,amount:number)=>{const id=randomUUID();await database.client`insert into usage_ledger(id,tenant_id,unit,type,amount,available_delta,reserved_delta,idempotency_key,correlation_id) values(${id},${f.tenantId},${unit},'GRANT',${amount},${amount},0,${id},${randomUUID()})`;return id;};
    const spend=async(unit:string,amount:number)=>{const id=randomUUID();await database.client`insert into usage_ledger(tenant_id,unit,type,amount,available_delta,reserved_delta,idempotency_key,correlation_id) values(${f.tenantId},${unit},'ADJUSTMENT',${-amount},${-amount},0,${id},${randomUUID()})`;};
    const first=await grant('AI_CREDITS',100);await spend('AI_CREDITS',89);await repository.projectBatch(f.tenantId);
    expect((await service.list(f.owner,f.tenantId,{})).items).toHaveLength(0);
    await spend('AI_CREDITS',1);await Promise.all([repository.projectBatch(f.tenantId),repository.projectBatch(f.tenantId)]);
    let items=(await service.list(f.owner,f.tenantId,{})).items;expect(items.map(item=>item.resourceId)).toEqual([first]);expect(items[0]!.type).toBe('LIMIT_WARNING');expect(items[0]!.href).toBe(`/billing?organization=${f.tenantId}`);
    expect((await service.list(f.editor,f.tenantId,{})).items).toHaveLength(0);
    const second=await grant('AI_CREDITS',100);await repository.projectBatch(f.tenantId);expect((await service.list(f.owner,f.tenantId,{})).items).toHaveLength(1);
    await spend('AI_CREDITS',100);await repository.projectBatch(f.tenantId);await repository.projectBatch(f.tenantId);
    items=(await service.list(f.owner,f.tenantId,{})).items;expect(new Set(items.map(item=>item.resourceId))).toEqual(new Set([first,second]));
    const video=await grant('VIDEO_SECONDS',100),reservation=randomUUID();
    await database.client`insert into usage_reservations(id,tenant_id,key,unit,amount) values(${reservation},${f.tenantId},${randomUUID()},'VIDEO_SECONDS',90)`;
    await database.client`insert into usage_ledger(tenant_id,unit,type,amount,available_delta,reserved_delta,reservation_id,idempotency_key,correlation_id) values(${f.tenantId},'VIDEO_SECONDS','RESERVE',90,-90,90,${reservation},${randomUUID()},${randomUUID()})`;
    await repository.projectBatch(f.tenantId);expect((await service.list(f.owner,f.tenantId,{})).items.map(item=>item.resourceId)).toContain(video);
  });
  it('routes script approval to approvers and failures to editors without copying audit payloads',async()=>{
    const f=await fixture();
    for(const action of ['JOB_SUCCEEDED','JOB_FAILED']){
      const jobId=randomUUID(),reservation=randomUUID();await database.client`insert into usage_reservations(id,tenant_id,key,unit,amount) values(${reservation},${f.tenantId},${randomUUID()},'AI_CREDITS',1)`;
      await database.client`insert into jobs(id,tenant_id,brand_id,requested_by,type,status,input,input_hash,idempotency_key,reservation_id,provider,model,correlation_id) values(${jobId},${f.tenantId},${f.brandId},${f.owner},'GENERATE_SCRIPT','SUCCEEDED','{}','fixture',${randomUUID()},${reservation},'mock','fixture',${randomUUID()})`;
      await database.client`insert into audit_logs(tenant_id,action,resource_id,correlation_id,metadata) values(${f.tenantId},${action},${jobId},${randomUUID()},'{"private":"must-not-leak"}')`;
    }
    await repository.projectBatch(f.tenantId);const approval=await service.list(f.approver,f.tenantId,{}),editor=await service.list(f.editor,f.tenantId,{});
    expect(approval.items.map(item=>item.type)).toEqual(['CONTENT_APPROVAL_REQUIRED']);expect(approval.items[0]!.href).toContain('&tab=scripts');expect(editor.items.map(item=>item.type).sort()).toEqual(['JOB_FAILED','SCRIPT_READY']);expect(editor.items.find(item=>item.type==='SCRIPT_READY')!.href).toContain('&tab=scripts');expect((await service.list(f.viewer,f.tenantId,{})).items).toHaveLength(0);expect(JSON.stringify(editor)).not.toContain('must-not-leak');
  });
});
