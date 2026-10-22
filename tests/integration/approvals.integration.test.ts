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
    const old=(await service.list(approver,tenant,{})).items.find(row=>row.id===request.id)!;expect(old.content.core).toBe('Core');expect(old.currentVersion).toBe(2);
    await service.decide(editor,tenant,request.id,{status:'CANCELLED'},correlation);
    const next=await service.create(editor,tenant,brand,{...input,version:2,idempotencyKey:randomUUID()},correlation);expect(next.id).not.toBe(request.id);
  });
  it('records rejection and requested changes without approving the material',async()=>{
    for(const status of ['REJECTED','CHANGES_REQUESTED']){const input=await fixture(),request=await service.create(editor,tenant,brand,input,correlation);expect(()=>service.decide(approver,tenant,request.id,{status,comment:''},correlation)).toThrow();await service.decide(approver,tenant,request.id,{status,comment:'Please revise the proof'},correlation);expect((await database.client`select approved_version from scripts where id=${input.scriptId}`)[0]!.approved_version).toBeNull();await expect(service.decide(approver,tenant,request.id,{status:'APPROVED'},correlation)).rejects.toThrow('CONFLICT');}
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
