import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import {comments} from '../../packages/db/src/schema/comments';
import {seedDevelopment,demoIds} from '../../packages/db/src/development-seed';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('comment storage constraints',()=>{
 const database=isolatedTestDatabase(url),{user,tenant,brand}=demoIds;
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
});
