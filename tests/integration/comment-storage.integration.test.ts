import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import {comments} from '../../packages/db/src/schema/comments';
import {CommentRepository} from '../../packages/db/src/repositories/comments';
import {CommentService} from '../../packages/core/src/comments';
import {seedDevelopment,demoIds} from '../../packages/db/src/development-seed';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('comment storage constraints',()=>{
 const database=isolatedTestDatabase(url),{user,tenant,brand}=demoIds;
 const service=new CommentService(new CommentRepository(database.db));
 async function member(role:string,disabled=false){const id=randomUUID();await database.client`insert into users(id,email,password_hash,name,email_verified_at,disabled_at) values(${id},${`${id}@example.test`},'unusable','Comment reviewer',now(),${disabled?new Date().toISOString():null})`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${id},${role})`;return id;}
 beforeAll(async()=>{await seedDevelopment(database.db,`scrypt:v1:${'0'.repeat(32)}:${'0'.repeat(128)}`);});
 async function publication(){
  const content=randomUUID(),connection=randomUUID(),calendar=randomUUID(),job=randomUUID(),id=randomUUID(),now=new Date().toISOString();
  await database.client`insert into social_connections(id,tenant_id,brand_id,provider,name,reference,idempotency_key,input_hash,status,created_by) values(${connection},${tenant},${brand},'youtube','Comment storage fixture',${JSON.stringify({provider:'youtube',internalId:connection,externalId:'UC'+connection.replaceAll('-','').slice(0,22),metadata:{}})},${randomUUID()},'fixture','REVOKED',${user})`;
  await database.client`insert into content_items(id,tenant_id,brand_id,title,type) values(${content},${tenant},${brand},'Comment fixture','POST')`;
  await database.client`insert into calendar_entries(id,tenant_id,brand_id,content_item_id,planned_at,time_zone,platform,caption,idempotency_key,input_hash,created_by) values(${calendar},${tenant},${brand},${content},${now},'UTC','YOUTUBE','Fixture',${randomUUID()},'fixture',${user})`;
  await database.client`insert into publishing_jobs(id,tenant_id,brand_id,calendar_id,calendar_revision,content_item_id,connection_id,credential_version,provider,snapshot,status,scheduled_at,next_attempt_at,idempotency_key,input_hash,approved_by,correlation_id) values(${job},${tenant},${brand},${calendar},0,${content},${connection},1,'youtube','{}'::jsonb,'PUBLISHED',${now},${now},${randomUUID()},'fixture',${user},${randomUUID()})`;
  await database.client`insert into publications(id,tenant_id,job_id,provider,reference,published_at) values(${id},${tenant},${job},'youtube',${JSON.stringify({provider:'youtube',internalId:id,externalId:'abcdefghijk',metadata:{}})},${now})`;
  return id;
 }
 function record(publicationId:string):typeof comments.$inferInsert{
  return {id:randomUUID(),tenantId:tenant,publicationId,provider:'youtube',externalCommentId:randomUUID(),externalThreadId:randomUUID(),text:'<script>untrusted comment text</script>',providerCreatedAt:new Date('2026-01-01T00:00:00Z'),providerUpdatedAt:new Date('2026-01-02T00:00:00Z'),firstObservedAt:new Date('2026-01-03T00:00:00Z'),lastObservedAt:new Date('2026-01-03T00:00:00Z'),replyCount:0,canReply:true,isPublic:true};
 }
 const insert=(input:typeof comments.$inferInsert)=>database.db.insert(comments).values(input).returning();
 it('preserves provider text, absent authors and unassessed sentiment without inventing review state',async()=>{
  const input=record(await publication()),[row]=await insert(input);
  expect(row).toMatchObject({text:input.text,authorName:null,externalAuthorId:null,sentiment:null,status:'NEW',contentRevision:0,revision:0});
  expect(row?.providerCreatedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  await expect(insert({...record(input.publicationId),text:'',authorName:''})).resolves.toHaveLength(1);
 });
 it('deduplicates external identity within a publication and rejects a foreign tenant publication',async()=>{
  const input=record(await publication());await insert(input);
  await expect(insert({...input,id:randomUUID()})).rejects.toThrow();
  await expect(insert({...input,id:randomUUID(),tenantId:randomUUID(),externalCommentId:randomUUID()})).rejects.toThrow();
  await expect(insert({...input,id:randomUUID(),publicationId:await publication()})).resolves.toHaveLength(1);
 });
 it('binds replies to the same tenant, publication and external thread',async()=>{
  const root=record(await publication());await insert(root);
  const reply={...record(root.publicationId),parentId:root.id!,externalThreadId:root.externalThreadId,replyCount:null,canReply:null,isPublic:null};
  await expect(insert(reply)).resolves.toHaveLength(1);
  await expect(insert({...reply,id:randomUUID(),externalCommentId:randomUUID(),externalThreadId:randomUUID()})).rejects.toThrow();
  await expect(insert({...reply,id:randomUUID(),externalCommentId:randomUUID(),publicationId:await publication()})).rejects.toThrow();
  const self=record(root.publicationId);await expect(insert({...self,parentId:self.id!,replyCount:null,canReply:null,isPublic:null})).rejects.toThrow();
 });
 it('rejects invalid timestamps, lengths, identities and thread metadata',async()=>{
  const input=record(await publication());
  await expect(insert({...input,id:randomUUID(),externalCommentId:'c'.repeat(256),externalThreadId:'t'.repeat(256)})).resolves.toHaveLength(1);
  for(const invalid of [
   {...input,externalCommentId:'c'.repeat(257)},
   {...input,externalThreadId:'t'.repeat(257)},
   {...input,providerUpdatedAt:new Date('2025-01-01T00:00:00Z')},
   {...input,lastObservedAt:new Date('2025-01-01T00:00:00Z')},
   {...input,text:'x'.repeat(10001)},
   {...input,authorName:'x'.repeat(1001)},
   {...input,externalAuthorId:'not-a-channel'},
   {...input,externalCommentId:'contains whitespace'},
   {...input,contentRevision:-1},
   {...input,replyCount:null},
  ])await expect(insert(invalid)).rejects.toThrow();
 });
 it('paginates roots with a stable tie breaker and keeps replies in their parent view',async()=>{
  const publicationId=await publication(),roots=Array.from({length:27},()=>record(publicationId));
  await database.db.insert(comments).values(roots);
  const parent=roots[0]!;await insert({...record(publicationId),parentId:parent.id!,externalThreadId:parent.externalThreadId,replyCount:null,canReply:null,isPublic:null});
  const first=await service.list(user,tenant,brand,publicationId,{});expect(first.items).toHaveLength(25);expect(first.next).not.toBeNull();
  const second=await service.list(user,tenant,brand,publicationId,first.next!);expect(second.items).toHaveLength(2);expect(second.next).toBeNull();expect(new Set([...first.items,...second.items].map(row=>row.id)).size).toBe(27);
  const replies=await service.list(user,tenant,brand,publicationId,{parentId:parent.id});expect(replies.items).toHaveLength(1);expect(replies.items[0]?.parentId).toBe(parent.id);
  await expect(service.list(user,tenant,brand,publicationId,{parentId:replies.items[0]!.id})).rejects.toThrow('NOT_FOUND');
  expect(()=>service.list(user,tenant,brand,publicationId,{afterId:randomUUID()})).toThrow();
 });
 it('requires current membership and the owning brand for every read and review',async()=>{
  const publicationId=await publication(),input=record(publicationId);await insert(input);
  const viewer=await member('VIEWER'),editor=await member('EDITOR'),disabled=await member('MANAGER',true),otherBrand=randomUUID();
  await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${otherBrand},${tenant},${demoIds.workspace},'Other comments brand')`;
  expect((await service.list(viewer,tenant,brand,publicationId,{})).items).toHaveLength(1);
  for(const actor of [viewer,editor])await expect(service.triage(actor,tenant,brand,publicationId,input.id!,{revision:0,contentRevision:0,status:'RESOLVED'},randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  await expect(service.list(disabled,tenant,brand,publicationId,{})).rejects.toThrow('NOT_FOUND');
  await expect(service.list(randomUUID(),tenant,brand,publicationId,{})).rejects.toThrow('NOT_FOUND');
  await expect(service.list(user,randomUUID(),brand,publicationId,{})).rejects.toThrow('NOT_FOUND');
  await expect(service.list(user,tenant,otherBrand,publicationId,{})).rejects.toThrow('NOT_FOUND');
  await expect(service.triage(user,tenant,otherBrand,publicationId,input.id!,{revision:0,contentRevision:0,status:'RESOLVED'},randomUUID())).rejects.toThrow('NOT_FOUND');
  await expect(service.list(user,tenant,brand,await publication(),{parentId:input.id})).rejects.toThrow('NOT_FOUND');
 });
 it('audits human triage without comment payloads and fences concurrent and stale review',async()=>{
  const publicationId=await publication(),input=record(publicationId);await insert(input);const manager=await member('MANAGER');
  const outcomes=await Promise.allSettled(['RESOLVED','NEEDS_HUMAN'].map(status=>service.triage(manager,tenant,brand,publicationId,input.id!,{revision:0,contentRevision:0,status},randomUUID())));
  expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(result=>result.status==='rejected')).toHaveLength(1);
  const row=(await service.list(user,tenant,brand,publicationId,{})).items[0]!;expect(row.revision).toBe(1);expect(row.sentiment).toBeNull();
  const audits=await database.client`select metadata from audit_logs where resource_id=${input.id!} and action='COMMENT_TRIAGED'`;expect(audits).toHaveLength(1);expect(JSON.stringify(audits)).not.toContain(input.text);
  const unchanged=await service.triage(manager,tenant,brand,publicationId,input.id!,{revision:1,contentRevision:0,status:row.status},randomUUID());expect(unchanged.revision).toBe(1);
  await database.client`update comments set content_revision=1,text='Provider edited text' where id=${input.id!}`;
  await expect(service.triage(manager,tenant,brand,publicationId,input.id!,{revision:1,contentRevision:0,status:'NEW'},randomUUID())).rejects.toThrow('CONFLICT');
  await service.triage(manager,tenant,brand,publicationId,input.id!,{revision:1,contentRevision:1,status:'NEW'},randomUUID());
  expect((await service.list(user,tenant,brand,publicationId,{status:'NEW'})).items).toHaveLength(1);
  expect((await service.list(user,tenant,brand,publicationId,{status:'RESOLVED'})).items).toHaveLength(0);
 });

});
