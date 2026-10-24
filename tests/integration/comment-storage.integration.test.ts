import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it,vi} from 'vitest';
import {commentReplyDrafts,commentReplyVersions} from '../../packages/db/src/schema/comment-replies';
import {emptyOnboarding} from '../../packages/types/src/index';
import {comments} from '../../packages/db/src/schema/comments';
import {commentImports,commentImportPages} from '../../packages/db/src/schema/comment-imports';
import {CommentRepository} from '../../packages/db/src/repositories/comments';
import {CommentImportRepository,type CommentImportJob} from '../../packages/db/src/repositories/comment-imports';
import {CommentImportPageRepository} from '../../packages/db/src/repositories/comment-import-pages';
import {advanceCommentThreads,advanceCommentReplies} from '../../packages/core/src/comment-import-position';
import {DomainError,type YouTubeCommentsProvider,type CommentImportPosition,type ImportedComment} from '../../packages/types/src/index';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import {CommentService} from '../../packages/core/src/comments';
import {CommentImportProcessor} from '../../packages/core/src/comment-import-processor';
import {CommentImportService} from '../../packages/core/src/comment-imports';
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

 async function importRecord(publicationId:string):Promise<typeof commentImports.$inferInsert>{
  const [target]=await database.client<{connection_id:string}[]>`select j.connection_id from publications p join publishing_jobs j on j.id=p.job_id and j.tenant_id=p.tenant_id where p.id=${publicationId} and p.tenant_id=${tenant}`;
  if(!target)throw new Error('Missing fixture publication');
  return {id:randomUUID(),tenantId:tenant,brandId:brand,publicationId,connectionId:target.connection_id,credentialVersion:1,videoId:'abcdefghijk',channelId:'UC'+'a'.repeat(22),requestedBy:user,idempotencyKey:randomUUID(),correlationId:randomUUID()};
 }
 it('keeps partial imports exclusive and preserves their resumable position',async()=>{
  const input=await importRecord(await publication()),[run]=await database.db.insert(commentImports).values(input).returning();
  expect(run).toMatchObject({status:'QUEUED',position:{kind:'THREADS',cursor:null},remainingPages:200,completedPages:0});
  await database.client`update comment_imports set status='PARTIAL',remaining_pages=0,position='{"kind":"THREADS","cursor":"opaque-next"}'::jsonb where id=${input.id!}`;
  await expect(database.db.insert(commentImports).values({...input,id:randomUUID(),idempotencyKey:randomUUID()})).rejects.toThrow();
  await database.client`update comment_imports set status='QUEUED',remaining_pages=200,revision=revision+1 where id=${input.id!}`;
  expect((await database.client`select position,revision from comment_imports where id=${input.id!}`)[0]).toEqual({position:{kind:'THREADS',cursor:'opaque-next'},revision:1});
 });
 it('requires leases for running imports and explicit terminal checkpoints',async()=>{
  const input=await importRecord(await publication());await database.db.insert(commentImports).values(input);
  await expect(database.client`update comment_imports set status='RUNNING' where id=${input.id!}`).rejects.toThrow();
  await expect(database.client`update comment_imports set remaining_pages=0 where id=${input.id!}`).rejects.toThrow();
  await expect(database.client`update comment_imports set status='SUCCEEDED',finished_at=now() where id=${input.id!}`).rejects.toThrow();
  await expect(database.client`update comment_imports set status='FAILED' where id=${input.id!}`).rejects.toThrow();
  await database.client`update comment_imports set status='RUNNING',lease_token=${randomUUID()},lease_expires_at=now()+interval '2 minutes',started_at=now() where id=${input.id!}`;
  await expect(database.client`update comment_imports set status='FAILED',finished_at=now() where id=${input.id!}`).rejects.toThrow();
  await database.client`update comment_imports set status='SUCCEEDED',position=null,finished_at=now(),lease_token=null,lease_expires_at=null where id=${input.id!}`;
 });
 it('deduplicates page receipts within a scope and enforces tenant ownership',async()=>{
  const input=await importRecord(await publication());await database.db.insert(commentImports).values(input);
  const receipt={tenantId:tenant,importId:input.id!,scope:'THREADS',cursorHash:'a'.repeat(64),ordinal:1,observedAt:new Date()};
  await database.db.insert(commentImportPages).values(receipt);
  await expect(database.db.insert(commentImportPages).values({...receipt,ordinal:2})).rejects.toThrow();
  await expect(database.db.insert(commentImportPages).values({...receipt,cursorHash:'b'.repeat(64)})).rejects.toThrow();
  await expect(database.db.insert(commentImportPages).values({...receipt,tenantId:randomUUID(),ordinal:2})).rejects.toThrow();
  await expect(database.db.insert(commentImportPages).values({...receipt,scope:randomUUID(),ordinal:2})).resolves.toBeDefined();
 });

 async function queueFixture(actor=user){
  const publicationId=await publication(),input=await importRecord(publicationId),connectionId=input.connectionId;
  const vault=new CredentialVault(JSON.stringify({fixture:Buffer.alloc(32,9).toString('base64')}),'fixture');
  const credential=vault.encrypt('synthetic unusable comment-import credential',{tenantId:tenant,brandId:brand,connectionId,provider:'youtube'});
  await database.client`update social_connections set status='ACTIVE',credential=${JSON.stringify(credential)}::jsonb,reference=jsonb_set(reference,'{metadata,commentsAuthorized}','true'::jsonb) where id=${connectionId}`;
  let now=new Date('2035-01-01T00:00:00Z');const repo=new CommentImportRepository(database.db,()=>now);
  const request=(key=randomUUID())=>repo.request(actor,tenant,brand,publicationId,key,randomUUID());
  return {repo,publicationId,connectionId,request,clock:()=>now,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
 }
 it('deduplicates import intent, enforces active/cooldown limits and exposes safe progress only',async()=>{
  const f=await queueFixture(),key=randomUUID();expect(await f.repo.latest(user,tenant,brand,f.publicationId)).toBeNull();
  const [a,b]=await Promise.all([f.request(key),f.request(key)]);expect(a.id).toBe(b.id);expect(a.status).toBe('QUEUED');
  const view=await f.repo.latest(user,tenant,brand,f.publicationId);expect(view?.id).toBe(a.id);expect(JSON.stringify(view)).not.toMatch(/position|cursor|credential|channelId/);
  await expect(f.request()).rejects.toThrow('CONFLICT');
  await expect(f.repo.request(user,tenant,brand,await publication(),key,randomUUID())).rejects.toThrow('CONFLICT');
  await f.repo.cancel(user,tenant,brand,f.publicationId,a.id,0);await expect(f.request()).rejects.toThrow('RATE_LIMITED');
  f.advance(61000);expect((await f.request()).id).not.toBe(a.id);
  const audits=await database.client`select metadata from audit_logs where resource_id=${a.id}`;expect(JSON.stringify(audits)).not.toMatch(/credential|cursor|ciphertext/);
 });
 it('fences lease takeover and caps retry attempts without accepting a stale executor',async()=>{
  const f=await queueFixture(),run=await f.request();
  const claims=await Promise.all([f.repo.claim(tenant,run.id),f.repo.claim(tenant,run.id)]),first=claims.find(Boolean)!;
  expect(claims.filter(Boolean)).toHaveLength(1);expect(first.attempt).toBe(1);await f.repo.prepare(first);
  f.advance(120001);const second=(await f.repo.claim(tenant,run.id))!;expect(second.attempt).toBe(2);expect(second.leaseToken).not.toBe(first.leaseToken);
  await expect(f.repo.prepare(first)).rejects.toThrow('CONFLICT');await f.repo.fail(first,'PROVIDER_UNAVAILABLE');expect((await f.repo.prepare(second)).status).toBe('RUNNING');
  await f.repo.fail(second,'PROVIDER_UNAVAILABLE');expect((await f.repo.due()).some(job=>job.id===run.id)).toBe(false);
  f.advance(20001);const third=(await f.repo.claim(tenant,run.id))!;expect(third.attempt).toBe(3);await f.repo.fail(third,'PROVIDER_UNAVAILABLE');
  expect((await f.repo.latest(user,tenant,brand,f.publicationId))?.status).toBe('FAILED');expect(await f.repo.claim(tenant,run.id)).toBeNull();
 });
 it('rechecks actor permissions and credential versions immediately before provider work',async()=>{
  const actor=await member('MANAGER'),f=await queueFixture(actor),run=await f.request(),job=(await f.repo.claim(tenant,run.id))!;
  await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${actor}`;
  await expect(f.repo.prepare(job)).rejects.toThrow('NOT_AUTHORIZED');await f.repo.fail(job,'NOT_AUTHORIZED');
  expect((await f.repo.latest(user,tenant,brand,f.publicationId))?.status).toBe('CANCELLED');
  const other=await queueFixture(),otherRun=await other.request(),otherJob=(await other.repo.claim(tenant,otherRun.id))!;
  await database.client`update social_connections set credential_version=credential_version+1 where id=${other.connectionId}`;
  await expect(other.repo.prepare(otherJob)).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');await other.repo.fail(otherJob,'SOCIAL_TOKEN_EXPIRED');
  expect((await other.repo.latest(user,tenant,brand,other.publicationId))?.status).toBe('CANCELLED');
  await expect(other.repo.request(actor,tenant,brand,other.publicationId,randomUUID(),randomUUID())).rejects.toThrow('NOT_AUTHORIZED');
  const scopeLost=await queueFixture(),scopeRun=await scopeLost.request(),scopeJob=(await scopeLost.repo.claim(tenant,scopeRun.id))!;
  await database.client`update social_connections set reference=jsonb_set(reference,'{metadata,commentsAuthorized}','false'::jsonb) where id=${scopeLost.connectionId}`;
  await expect(scopeLost.repo.prepare(scopeJob)).rejects.toThrow('NOT_AUTHORIZED');
 });
 it('resumes only the current requester and invalidates running work on cancellation',async()=>{
  const f=await queueFixture(),run=await f.request(),manager=await member('MANAGER');
  await database.client`update comment_imports set status='PARTIAL',remaining_pages=0,position='{"kind":"THREADS","cursor":"retained-token"}'::jsonb where id=${run.id}`;
  await expect(f.repo.resume(manager,tenant,brand,f.publicationId,run.id,0)).rejects.toThrow('NOT_AUTHORIZED');
  await expect(f.repo.resume(user,tenant,brand,f.publicationId,run.id,1)).rejects.toThrow('CONFLICT');
  const resumed=await f.repo.resume(user,tenant,brand,f.publicationId,run.id,0);expect(resumed).toMatchObject({status:'QUEUED',revision:1,remainingPages:200});
  const job=(await f.repo.claim(tenant,run.id))!;expect(job.position).toEqual({kind:'THREADS',cursor:'retained-token'});
  await expect(f.repo.cancel(manager,tenant,brand,f.publicationId,run.id,0)).rejects.toThrow('CONFLICT');
  await f.repo.cancel(manager,tenant,brand,f.publicationId,run.id,job.revision);await expect(f.repo.prepare(job)).rejects.toThrow('CONFLICT');
  expect((await f.repo.cancel(manager,tenant,brand,f.publicationId,run.id,0)).status).toBe('CANCELLED');
 });
 it('fails malformed persisted positions explicitly instead of retrying them forever',async()=>{
  const f=await queueFixture(),run=await f.request();await database.client`update comment_imports set position='{"kind":"THREADS","cursor":"invalid cursor"}'::jsonb where id=${run.id}`;
  expect(await f.repo.claim(tenant,run.id)).toBeNull();expect(await f.repo.latest(user,tenant,brand,f.publicationId)).toMatchObject({status:'FAILED',errorCode:'PROVIDER_REJECTED'});
 });

 it('reports missing import configuration explicitly while preserving read and cancellation access',async()=>{
  const f=await queueFixture(),service=new CommentImportService(f.repo,false);
  expect(await service.latest(user,tenant,brand,f.publicationId)).toMatchObject({job:null,configuration:{ready:false,status:'CONFIGURATION_REQUIRED'}});
  expect(()=>service.request(user,tenant,brand,f.publicationId,{idempotencyKey:randomUUID()},randomUUID())).toThrow('CONFIGURATION_REQUIRED');
  expect(()=>new CommentImportService(f.repo,true).request(user,tenant,brand,f.publicationId,{idempotencyKey:'bad'},randomUUID())).toThrow();
  const run=await f.request();expect((await service.cancel(user,tenant,brand,f.publicationId,run.id,{revision:0})).status).toBe('CANCELLED');
 });

 const plan=(position:CommentImportPosition,nextCursor:string|null,parentIds:string[])=>position.kind==='THREADS'?advanceCommentThreads(position,{nextCursor,parentIds}):advanceCommentReplies(position,{nextCursor});
 const imported=(externalId:string,parentExternalId:string|null=null):ImportedComment=>({externalId,parentExternalId,authorExternalId:null,authorName:null,text:'Untrusted <script>text</script>',publishedAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z'});
 const threadItem=(id:string,count=0)=>({externalId:'thread-'+id,comment:imported(id),replyCount:count,canReply:true,isPublic:true});
 const threadPage=(job:CommentImportJob,items:ReturnType<typeof threadItem>[],nextCursor:string|null=null)=>({reference:{provider:'youtube',internalId:job.id,externalId:job.videoId,metadata:{kind:'comment-threads',channelId:job.channelId}},observedAt:job.startedAt!.toISOString(),nextCursor,items});
 const replyPage=(job:CommentImportJob,parent:string,items:ImportedComment[],nextCursor:string|null=null)=>({reference:{provider:'youtube',internalId:job.id,externalId:parent,metadata:{kind:'comment-replies',channelId:job.channelId}},observedAt:job.startedAt!.toISOString(),nextCursor,items});
 it('atomically imports threads and all reply pages while preserving local triage across provider edits',async()=>{
  const f=await queueFixture(),pages=new CommentImportPageRepository(database.db,f.clock),run=await f.request(),first=(await f.repo.claim(tenant,run.id))!;
  expect(await pages.complete(first,threadPage(first,[threadItem('root',2)]),plan)).toMatchObject({status:'QUEUED',completedPages:1});
  const root=(await service.list(user,tenant,brand,f.publicationId,{})).items[0]!;
  await service.triage(user,tenant,brand,f.publicationId,root.id,{revision:0,contentRevision:0,status:'NEEDS_HUMAN'},randomUUID());
  const second=(await f.repo.claim(tenant,run.id))!;await pages.complete(second,replyPage(second,'root',[imported('reply-one','root')],'next-replies'),plan);
  const third=(await f.repo.claim(tenant,run.id))!;expect(await pages.complete(third,replyPage(third,'root',[imported('reply-two','root')]),plan)).toMatchObject({status:'SUCCEEDED',completedPages:3});
  await expect(pages.complete(third,replyPage(third,'root',[]),plan)).rejects.toThrow('CONFLICT');
  expect((await service.list(user,tenant,brand,f.publicationId,{parentId:root.id})).items).toHaveLength(2);
  f.advance(61000);const update=await f.request(),updateJob=(await f.repo.claim(tenant,update.id))!,item=threadItem('root');item.comment={...item.comment,text:'Edited question',updatedAt:'2026-01-03T00:00:00.000Z'};
  await pages.complete(updateJob,threadPage(updateJob,[item]),plan);
  expect((await service.list(user,tenant,brand,f.publicationId,{})).items[0]).toMatchObject({id:root.id,status:'NEEDS_HUMAN',revision:1,contentRevision:1,text:'Edited question',sentiment:null});
  await expect(service.triage(user,tenant,brand,f.publicationId,root.id,{revision:1,contentRevision:0,status:'RESOLVED'},randomUUID())).rejects.toThrow('CONFLICT');
  expect((await service.list(user,tenant,brand,f.publicationId,{parentId:root.id})).items).toHaveLength(2);
  const audits=await database.client`select metadata from audit_logs where resource_id=${run.id} and action='COMMENT_IMPORT_PAGE_SAVED'`;expect(audits).toHaveLength(3);expect(JSON.stringify(audits)).not.toContain('Untrusted');
  f.advance(61000);const stale=await f.request(),staleJob=(await f.repo.claim(tenant,stale.id))!;await pages.complete(staleJob,threadPage(staleJob,[threadItem('root')]),plan);
  expect((await service.list(user,tenant,brand,f.publicationId,{})).items[0]).toMatchObject({text:'Edited question',contentRevision:1,status:'NEEDS_HUMAN'});
 });
 it('rolls back every imported row and receipt when a later item tries to change an existing association',async()=>{
  const f=await queueFixture(),pages=new CommentImportPageRepository(database.db,f.clock),original=record(f.publicationId);original.externalCommentId='existing';await insert(original);
  const run=await f.request(),job=(await f.repo.claim(tenant,run.id))!;
  await expect(pages.complete(job,threadPage(job,[threadItem('new-first'),threadItem('existing')]),plan)).rejects.toThrow('PROVIDER_REJECTED');
  expect((await service.list(user,tenant,brand,f.publicationId,{})).items).toHaveLength(1);
  expect((await database.client`select count(*)::int as count from comment_import_pages where import_id=${run.id}`)[0]?.count).toBe(0);
 });
 it('rechecks access after the remote read and rejects a mismatched channel before saving',async()=>{
  const actor=await member('MANAGER'),f=await queueFixture(actor),pages=new CommentImportPageRepository(database.db,f.clock),run=await f.request(),job=(await f.repo.claim(tenant,run.id))!,result=threadPage(job,[threadItem('unwritten')]);
  await expect(pages.complete(job,{...result,reference:{...result.reference,metadata:{...result.reference.metadata,channelId:'UC'+'z'.repeat(22)}}},plan)).rejects.toThrow('PROVIDER_REJECTED');
  await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${actor}`;
  await expect(pages.complete(job,result,plan)).rejects.toThrow('NOT_AUTHORIZED');
  expect((await service.list(user,tenant,brand,f.publicationId,{})).items).toHaveLength(0);
 });
 it('detects longer cursor cycles and rolls back the page that would enter the cycle',async()=>{
  const f=await queueFixture(),pages=new CommentImportPageRepository(database.db,f.clock),run=await f.request();
  for(const cursor of ['A','B']){const job=(await f.repo.claim(tenant,run.id))!;await pages.complete(job,threadPage(job,[],cursor),plan);}
  const job=(await f.repo.claim(tenant,run.id))!;await expect(pages.complete(job,threadPage(job,[threadItem('cycle-row')],'A'),plan)).rejects.toThrow('PROVIDER_REJECTED');
  expect((await service.list(user,tenant,brand,f.publicationId,{})).items).toHaveLength(0);
  expect((await database.client`select count(*)::int as count from comment_import_pages where import_id=${run.id}`)[0]?.count).toBe(2);
 });
 it('resumes the exact unread reply position after reaching the page budget',async()=>{
  const f=await queueFixture(),pages=new CommentImportPageRepository(database.db,f.clock),run=await f.request();await database.client`update comment_imports set remaining_pages=1 where id=${run.id}`;
  const job=(await f.repo.claim(tenant,run.id))!;expect(await pages.complete(job,threadPage(job,[threadItem('budget-root',1)]),plan)).toMatchObject({status:'PARTIAL'});
  expect(await f.repo.claim(tenant,run.id)).toBeNull();const partial=(await f.repo.latest(user,tenant,brand,f.publicationId))!;
  await f.repo.resume(user,tenant,brand,f.publicationId,run.id,partial.revision);const next=(await f.repo.claim(tenant,run.id))!;expect(next.position?.kind).toBe('REPLIES');
  expect(await pages.complete(next,replyPage(next,'budget-root',[]),plan)).toMatchObject({status:'SUCCEEDED',completedPages:2});
 });

 it('rejects another run or video and observations outside the leased read window',async()=>{
  const f=await queueFixture(),pages=new CommentImportPageRepository(database.db,f.clock),run=await f.request(),job=(await f.repo.claim(tenant,run.id))!,result=threadPage(job,[threadItem('scope-root')]);
  for(const reference of [{...result.reference,internalId:randomUUID()},{...result.reference,externalId:'zyxwvutsrqp'}])await expect(pages.complete(job,{...result,reference},plan)).rejects.toThrow('PROVIDER_REJECTED');
  for(const offset of [-1,5001])await expect(pages.complete(job,{...result,observedAt:new Date(f.clock().getTime()+offset).toISOString()},plan)).rejects.toThrow('CONFLICT');
  await database.client`update social_connections set credential_version=credential_version+1 where id=${f.connectionId}`;
  await expect(pages.complete(job,result,plan)).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');
  expect((await service.list(user,tenant,brand,f.publicationId,{})).items).toHaveLength(0);
 });

 async function processorFixture(){
  const f=await queueFixture(),run=await f.request();
  const [connection]=await database.client<{reference:{externalId:string}}[]>`select reference from social_connections where id=${f.connectionId}`;
  const channelId=connection!.reference.externalId;
  const access={accessForComments:vi.fn(async()=>({accessToken:'synthetic-token',channelId}))};
  const provider:YouTubeCommentsProvider={
   commentThreads:vi.fn(async(_token,video,channel,_cursor,context)=>({reference:{provider:'youtube',internalId:context.internalId,externalId:video,metadata:{kind:'comment-threads',channelId:channel}},observedAt:f.clock().toISOString(),nextCursor:null,items:[threadItem('processor-root',1)]})),
   commentReplies:vi.fn(async(_token,parent,channel,_cursor,context)=>({reference:{provider:'youtube',internalId:context.internalId,externalId:parent,metadata:{kind:'comment-replies',channelId:channel}},observedAt:f.clock().toISOString(),nextCursor:null,items:[imported('processor-reply',parent)]})),
  };
  const pages=new CommentImportPageRepository(database.db,f.clock),processor=new CommentImportProcessor(f.repo,pages,access,provider);
  return {...f,run,channelId,access,provider,pages,processor};
 }
 it('processes one page per lease and resolves stored root identities for replies',async()=>{
  const f=await processorFixture();await f.processor.run(tenant,f.run.id);
  expect(await f.repo.latest(user,tenant,brand,f.publicationId)).toMatchObject({status:'QUEUED',completedPages:1});
  expect(f.provider.commentReplies).not.toHaveBeenCalled();
  await f.processor.run(tenant,f.run.id);
  expect(await f.repo.latest(user,tenant,brand,f.publicationId)).toMatchObject({status:'SUCCEEDED',completedPages:2});
  expect(f.provider.commentReplies).toHaveBeenCalledWith('synthetic-token','processor-root',f.channelId,null,expect.objectContaining({internalId:f.run.id,tenantId:tenant}));
  expect(f.access.accessForComments).toHaveBeenCalledTimes(4);
  const root=(await service.list(user,tenant,brand,f.publicationId,{})).items[0]!;
  expect((await service.list(user,tenant,brand,f.publicationId,{parentId:root.id})).items).toHaveLength(1);
  await f.processor.run(tenant,f.run.id);expect(f.provider.commentThreads).toHaveBeenCalledTimes(1);
 });
 it('discards a remotely read page when encrypted scope authorization is revoked',async()=>{
  const f=await processorFixture();f.access.accessForComments.mockRejectedValueOnce(new DomainError('NOT_AUTHORIZED',403));
  await f.processor.run(tenant,f.run.id);expect(f.provider.commentThreads).not.toHaveBeenCalled();
  expect(await f.repo.latest(user,tenant,brand,f.publicationId)).toMatchObject({status:'CANCELLED',errorCode:'NOT_AUTHORIZED'});
  const after=await processorFixture();after.access.accessForComments.mockResolvedValueOnce({accessToken:'synthetic-token',channelId:after.channelId}).mockRejectedValueOnce(new DomainError('NOT_AUTHORIZED',403));
  await after.processor.run(tenant,after.run.id);expect(after.provider.commentThreads).toHaveBeenCalledTimes(1);
  expect(await after.repo.latest(user,tenant,brand,after.publicationId)).toMatchObject({status:'CANCELLED',completedPages:0});
  expect((await service.list(user,tenant,brand,after.publicationId,{})).items).toHaveLength(0);
 });
 it('rejects a changed channel and missing provider without remote reads',async()=>{
  const f=await processorFixture();f.access.accessForComments.mockResolvedValue({accessToken:'synthetic-token',channelId:'UC'+'z'.repeat(22)});
  await f.processor.run(tenant,f.run.id);expect(f.provider.commentThreads).not.toHaveBeenCalled();
  expect(await f.repo.latest(user,tenant,brand,f.publicationId)).toMatchObject({status:'CANCELLED',errorCode:'NOT_AUTHORIZED'});
  const missing=await processorFixture();await new CommentImportProcessor(missing.repo,missing.pages,missing.access,null).run(tenant,missing.run.id);
  expect(await missing.repo.latest(user,tenant,brand,missing.publicationId)).toMatchObject({status:'FAILED',errorCode:'CONFIGURATION_REQUIRED'});
  expect(missing.access.accessForComments).not.toHaveBeenCalled();
 });
 it('persists retry state without exposing raw provider exceptions to the reporter',async()=>{
  const f=await processorFixture();vi.mocked(f.provider.commentThreads).mockRejectedValue(new Error('sensitive-provider-payload'));
  const capture=vi.fn(),processor=new CommentImportProcessor(f.repo,f.pages,f.access,f.provider,{capture});
  await processor.run(tenant,f.run.id);
  expect(await f.repo.latest(user,tenant,brand,f.publicationId)).toMatchObject({status:'QUEUED',errorCode:'PROVIDER_UNAVAILABLE',completedPages:0,attempt:1});
  expect(capture.mock.calls[0]?.[0].message).toBe('PROVIDER_UNAVAILABLE');
  await processor.run(tenant,f.run.id);expect(f.provider.commentThreads).toHaveBeenCalledTimes(1);
 });

 it('refuses reply positions pointing outside the publication or to another reply',async()=>{
  const f=await processorFixture(),other=record(await publication());await insert(other);
  const root=record(f.publicationId);await insert(root);
  const child={...record(f.publicationId),parentId:root.id!,externalThreadId:root.externalThreadId,replyCount:null,canReply:null,isPublic:null};await insert(child);
  const job=(await f.repo.claim(tenant,f.run.id))!;
  for(const parentId of [other.id!,child.id!,randomUUID()]){
   const position={kind:'REPLIES' as const,cursor:null,parentId,pendingParentIds:[],nextThreadCursor:null};
   await database.client`update comment_imports set position=${JSON.stringify(position)}::jsonb where id=${job.id}`;
   await expect(f.repo.preparePage({...job,position})).rejects.toThrow('PROVIDER_REJECTED');
  }
 });

 async function draftFixture(){
  const publicationId=await publication(),comment=record(publicationId);await insert(comment);
  const [draft]=await database.db.insert(commentReplyDrafts).values({tenantId:tenant,publicationId,commentId:comment.id!}).returning();
  const version={tenantId:tenant,publicationId,commentId:comment.id!,draftId:draft!.id,version:1,source:'HUMAN' as const,createdBy:user,input:{brain:emptyOnboarding('Draft fixture'),brandRevision:0,comment:{id:comment.id!,contentRevision:0,reviewRevision:0,text:comment.text,parentText:null}},content:{reply:'Human draft',sentiment:null,risks:[]}};
  return {publicationId,comment,draft:draft!,version};
 }
 it('binds reply drafts to the exact tenant, publication and comment',async()=>{
  const f=await draftFixture();
  await expect(database.db.insert(commentReplyDrafts).values({tenantId:tenant,publicationId:f.publicationId,commentId:f.comment.id!})).rejects.toThrow();
  await expect(database.db.insert(commentReplyDrafts).values({tenantId:tenant,publicationId:await publication(),commentId:f.comment.id!})).rejects.toThrow();
  await expect(database.db.insert(commentReplyDrafts).values({tenantId:randomUUID(),publicationId:f.publicationId,commentId:f.comment.id!})).rejects.toThrow();
 });
 it('stores separate reply versions and rejects duplicate or cross-scope history entries',async()=>{
  const f=await draftFixture(),other=await draftFixture();
  await database.db.insert(commentReplyVersions).values(f.version);
  await expect(database.db.insert(commentReplyVersions).values(f.version)).rejects.toThrow();
  await expect(database.db.insert(commentReplyVersions).values({...f.version,version:2,draftId:other.draft.id})).rejects.toThrow();
  await expect(database.db.insert(commentReplyVersions).values({...f.version,version:2,tenantId:randomUUID()})).rejects.toThrow();
  await database.db.insert(commentReplyVersions).values({...f.version,version:2,content:{...f.version.content,reply:'Edited human draft'}});
  const rows=await database.client`select version,content from comment_reply_versions where draft_id=${f.draft.id} order by version`;
  expect(rows.map(row=>row.content.reply)).toEqual(['Human draft','Edited human draft']);
 });
 it('requires valid provenance and snapshot identity for reply history',async()=>{
  const f=await draftFixture();
  for(const value of [{...f.version,version:0},{...f.version,source:'AI' as const},{...f.version,jobId:randomUUID()},{...f.version,input:{...f.version.input,comment:{...f.version.input.comment,id:randomUUID()}}}])await expect(database.db.insert(commentReplyVersions).values(value)).rejects.toThrow();
  await database.db.insert(commentReplyVersions).values(f.version);
  await expect(database.client`update comment_reply_versions set input=input #- '{comment,reviewRevision}' where draft_id=${f.draft.id}`).rejects.toThrow();
  await expect(database.client`update comment_reply_versions set content=content-'risks' where draft_id=${f.draft.id}`).rejects.toThrow();
  await expect(database.client`update comment_reply_versions set content=jsonb_set(content,'{reply}',to_jsonb(${''.padEnd(2001,'x')}::text)) where draft_id=${f.draft.id}`).rejects.toThrow();
 });

});
