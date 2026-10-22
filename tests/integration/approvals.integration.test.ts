import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import {NotificationRepository,ApprovalRepository,ContentRepository} from '../../packages/db/src/index';
import {NotificationService} from '../../packages/core/src/notifications';
import {ApprovalService} from '../../packages/core/src/approvals';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('assigned version-bound script approvals',()=>{
  const database=isolatedTestDatabase(url),service=new ApprovalService(new ApprovalRepository(database.db)),content=new ContentRepository(database.db);
  const tenant=randomUUID(),brand=randomUUID(),editor=randomUUID(),approver=randomUUID(),manager=randomUUID(),viewer=randomUUID(),outsider=randomUUID(),correlation=randomUUID();
  const scriptContent={hook:'Hook',context:'Context',core:'Core',proof:'Proof',cta:'CTA',factCheckNotes:[]};
  beforeAll(async()=>{
    await database.client`insert into organizations(id,name) values(${tenant},'Fixture')`;await database.client`insert into workspaces(id,tenant_id,name) values(${tenant},${tenant},'Fixture')`;await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brand},${tenant},${tenant},'Fixture')`;
    for(const [id,role] of [[editor,'EDITOR'],[approver,'CLIENT_APPROVER'],[manager,'MANAGER'],[viewer,'VIEWER'],[outsider,null]] as const){await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Fixture','unusable',now())`;if(role)await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${id},${role})`;}
  });
  async function fixture(){const scriptId=randomUUID(),item=randomUUID();await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${item},${tenant},${brand},'Approval fixture','SHORT_VIDEO')`;await database.client`insert into scripts(id,tenant_id,brand_id,content_item_id,current_version,platform,duration) values(${scriptId},${tenant},${brand},${item},1,'YOUTUBE',30)`;await database.client`insert into script_versions(tenant_id,script_id,version,content,created_by) values(${tenant},${scriptId},1,${JSON.stringify(scriptContent)}::jsonb,${editor})`;return {scriptId,version:1,requestedFrom:approver,comment:'Review this exact version',idempotencyKey:randomUUID()};}
  it('deduplicates requests and decisions atomically with actual script approval',async()=>{
    const input=await fixture(),[a,b]=await Promise.all([service.create(editor,tenant,brand,input,correlation),service.create(editor,tenant,brand,input,correlation)]);expect(a).toEqual(b);const notices=await new NotificationService(new NotificationRepository(database.db)).list(approver,tenant,{});expect(notices.items.filter(row=>row.resourceId===a!.id)).toHaveLength(1);expect(notices.items.find(row=>row.resourceId===a!.id)?.href).toBe(`/approvals?organization=${tenant}`);
    await expect(service.create(editor,tenant,brand,{...input,comment:'changed'},correlation)).rejects.toThrow('CONFLICT');
    const decision={status:'APPROVED',comment:'Reviewed'};const result=await Promise.all([service.decide(approver,tenant,a!.id,decision,correlation),service.decide(approver,tenant,a!.id,decision,correlation)]);expect(result[0]).toEqual(result[1]);
    expect((await database.client`select approved_version,approved_by from scripts where id=${input.scriptId}`)[0]).toEqual({approved_version:1,approved_by:approver});
    expect(await database.client`select id from audit_logs where action='SCRIPT_APPROVED' and resource_id=${input.scriptId}`).toHaveLength(1);
    await expect(database.client`update approval_requests set comment='changed' where id=${a!.id}`).rejects.toThrow('immutable');
    await expect(database.client`delete from approval_requests where id=${a!.id}`).rejects.toThrow('cannot be deleted');
  });
  it('denies unassigned, viewer and foreign-tenant actions and redacts request internals',async()=>{
    const input=await fixture(),request=await service.create(editor,tenant,brand,input,correlation);
    for(const actor of [editor,manager,viewer])await expect(service.decide(actor,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.create(viewer,tenant,brand,await fixture(),correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.create(editor,tenant,randomUUID(),await fixture(),correlation)).rejects.toThrow('NOT_FOUND');
    await expect(service.list(outsider,tenant,{})).rejects.toThrow('NOT_FOUND');
    expect((await service.list(viewer,tenant,{})).items).toEqual([]);
    const page=await service.list(approver,tenant,{});expect(page.items.some(row=>row.id===request.id)).toBe(true);expect(JSON.stringify(page)).not.toMatch(/inputHash|idempotencyKey|passwordHash/);
    expect((await service.reviewers(editor,tenant)).map(row=>row.id).sort()).toEqual([approver,manager].sort());
  });
  it('fences edited versions, retains review text and allows cancellation followed by a fresh request',async()=>{
    const input=await fixture(),request=await service.create(editor,tenant,brand,input,correlation);
    await content.editScript(editor,tenant,brand,input.scriptId,1,{...scriptContent,core:'Updated'},correlation);
    await expect(service.decide(approver,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('CONFLICT');
    const old=(await service.list(approver,tenant,{})).items.find(row=>row.id===request.id)!;expect(old.entityType==='SCRIPT'&&old.content.core).toBe('Core');expect(old.currentVersion).toBe(2);
    await service.decide(editor,tenant,request.id,{status:'CANCELLED'},correlation);
    const next=await service.create(editor,tenant,brand,{...input,version:2,idempotencyKey:randomUUID()},correlation);expect(next.id).not.toBe(request.id);
  });
  it('records rejection and requested changes without approving the material',async()=>{
    for(const status of ['REJECTED','CHANGES_REQUESTED']){const input=await fixture(),request=await service.create(editor,tenant,brand,input,correlation);expect(()=>service.decide(approver,tenant,request.id,{status,comment:''},correlation)).toThrow();await service.decide(approver,tenant,request.id,{status,comment:'Please revise the proof'},correlation);expect((await database.client`select approved_version from scripts where id=${input.scriptId}`)[0]!.approved_version).toBeNull();await expect(service.decide(approver,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('CONFLICT');}
  });
  it('stores standalone comments once without changing the decision and enforces current access',async()=>{
    const input=await fixture(),request=await service.create(editor,tenant,brand,input,correlation),comment={body:'Please clarify the source',idempotencyKey:randomUUID()};
    const [first,retry]=await Promise.all([service.comment(approver,tenant,request.id,comment,correlation),service.comment(approver,tenant,request.id,comment,correlation)]);expect(first).toEqual(retry);
    expect((await database.client`select status,comment from approval_requests where id=${request.id}`)[0]).toEqual({status:'PENDING',comment:null});
    await expect(service.comment(approver,tenant,request.id,{...comment,body:'Different'},correlation)).rejects.toThrow('CONFLICT');
    const list=await service.comments(editor,tenant,request.id,{});expect(list.items).toHaveLength(1);expect(list.items[0]?.body).toBe(comment.body);expect(JSON.stringify(list)).not.toMatch(/idempotencyKey|password|email/);
    await expect(service.comments(viewer,tenant,request.id,{})).rejects.toThrow('NOT_FOUND');await expect(service.comment(outsider,tenant,request.id,comment,correlation)).rejects.toThrow('NOT_FOUND');
    await expect(service.comments(approver,randomUUID(),request.id,{})).rejects.toThrow('NOT_FOUND');
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${approver}`;
    await expect(service.comment(approver,tenant,request.id,{...comment,idempotencyKey:randomUUID()},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update organization_members set role='CLIENT_APPROVER' where tenant_id=${tenant} and user_id=${approver}`;
    await expect(database.client`update approval_comments set body='Changed' where id=${first.id}`).rejects.toThrow('immutable');await expect(database.client`delete from approval_comments where id=${first.id}`).rejects.toThrow('immutable');
    expect(JSON.stringify(await database.client`select metadata from audit_logs where resource_id=${request.id} and action='APPROVAL_COMMENT_ADDED'`)).not.toContain(comment.body);
  });
  it('paginates comments with request-scoped cursors and caps discussion size',async()=>{
    const request=await service.create(editor,tenant,brand,await fixture(),correlation);
    await database.client`insert into approval_comments(tenant_id,request_id,user_id,body,idempotency_key,created_at) select ${tenant},${request.id},${editor},'Comment '||n,gen_random_uuid(),now() from generate_series(1,200) n`;
    let cursor:string|undefined;const ids:string[]=[];do{const page=await service.comments(approver,tenant,request.id,{cursor});expect(page.items.some(item=>ids.includes(item.id))).toBe(false);ids.push(...page.items.map(item=>item.id));cursor=page.nextCursor??undefined;}while(cursor);
    expect(ids).toHaveLength(200);expect(new Set(ids).size).toBe(200);
    await expect(service.comment(editor,tenant,request.id,{body:'Over limit',idempotencyKey:randomUUID()},correlation)).rejects.toThrow('PLAN_LIMIT_REACHED');
    const other=await service.create(editor,tenant,brand,await fixture(),correlation);await expect(service.comments(approver,tenant,other.id,{cursor:ids[0]})).rejects.toThrow('NOT_FOUND');
  });
  it('filters requests and counts only visible pending work independent of pagination',async()=>{
    const before=(await service.list(approver,tenant,{})).pendingCount,request=await service.create(editor,tenant,brand,await fixture(),correlation);
    const pending=await service.list(approver,tenant,{status:'PENDING'});expect(pending.pendingCount).toBe(before+1);expect(pending.items.every(item=>item.status==='PENDING')).toBe(true);
    expect((await service.list(viewer,tenant,{})).pendingCount).toBe(0);
    await service.decide(approver,tenant,request.id,{status:'REJECTED',comment:'Needs revision'},correlation);
    expect((await service.list(approver,tenant,{status:'REJECTED'})).items.some(item=>item.id===request.id)).toBe(true);expect((await service.list(approver,tenant,{})).pendingCount).toBe(before);
  });
  it('rechecks assignee role and account state before recording a decision',async()=>{
    const input=await fixture(),request=await service.create(editor,tenant,brand,input,correlation);
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${approver}`;
    await expect(service.decide(approver,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update organization_members set role='CLIENT_APPROVER' where tenant_id=${tenant} and user_id=${approver}`;
    await database.client`update users set disabled_at=now() where id=${approver}`;
    await expect(service.decide(approver,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('NOT_FOUND');
    expect((await database.client`select status from approval_requests where id=${request.id}`)[0]!.status).toBe('PENDING');
  });
});
