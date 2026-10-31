import {randomUUID} from 'node:crypto';
import type {createDatabase} from '../../packages/db/src/index';
/** Stored terminal evidence only: no runnable jobs, credential or external request. */
export async function publicationDetailFixture(sql:ReturnType<typeof createDatabase>['client']){
  const user=randomUUID(),outsider=randomUUID(),tenant=randomUUID(),foreign=randomUUID(),brand=randomUUID(),otherBrand=randomUUID(),publication=randomUUID(),job=randomUUID(),calendar=randomUUID(),content=randomUUID(),connection=randomUUID();
  const title=`Saved publication ${randomUUID()}`,contentTitle=`Current material ${randomUUID()}`,needle=`Publicationneedle${randomUUID()}`,privateMarker='internal_fixture_not_for_display';
  const caption=needle+' <script>alert(1)</script> <img src=x onerror=alert(1)> '+('longword'.repeat(100));
  for(const id of [user,outsider])await sql`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Publication reader','unusable',now())`;
  for(const id of [tenant,foreign]){await sql`insert into organizations(id,name) values(${id},'Publication fixture')`;await sql`insert into workspaces(id,tenant_id,name) values(${id},${id},'Workspace')`;await sql`insert into organization_members(tenant_id,user_id,role) values(${id},${user},'VIEWER')`;}
  for(const id of [brand,otherBrand])await sql`insert into brands(id,tenant_id,workspace_id,name) values(${id},${tenant},${tenant},'Publication brand')`;
  await sql`insert into brands(id,tenant_id,workspace_id,name) values(${foreign},${foreign},${foreign},'Foreign brand')`;
  await sql`insert into content_items(id,tenant_id,brand_id,title,type,status) values(${content},${tenant},${brand},${contentTitle},'POST','PUBLISHED')`;
  await sql`insert into calendar_entries(id,tenant_id,brand_id,content_item_id,planned_at,time_zone,platform,caption,idempotency_key,input_hash,created_by) values(${calendar},${tenant},${brand},${content},'2025-01-01T12:00:00Z','UTC','TELEGRAM','Current calendar draft',${randomUUID()},'fixture',${user})`;
  const reference=JSON.stringify({provider:'telegram',internalId:connection,externalId:'fixture-channel',metadata:{privateMarker}});
  await sql`insert into social_connections(id,tenant_id,brand_id,provider,reference,name,status,idempotency_key,input_hash,created_by) values(${connection},${tenant},${brand},'telegram',${reference}::jsonb,'Disconnected fixture','REVOKED',${randomUUID()},'fixture',${user})`;
  const snapshot={title,type:'POST',caption,privacy:'PRIVATE',commentsEnabled:false,timeZone:'Europe/Moscow',videoProjectId:null,finalKey:privateMarker};
  await sql`insert into publishing_jobs(id,tenant_id,brand_id,calendar_id,calendar_revision,content_item_id,connection_id,credential_version,provider,snapshot,status,scheduled_at,next_attempt_at,idempotency_key,input_hash,approved_by,correlation_id,created_at) values(${job},${tenant},${brand},${calendar},0,${content},${connection},1,'telegram',${JSON.stringify(snapshot)}::jsonb,'PUBLISHED','2025-01-01T12:00:00Z','2025-01-01T12:00:00Z',${randomUUID()},'fixture',${user},${randomUUID()},now()-interval '1 year')`;
  const pubReference=JSON.stringify({provider:'telegram',internalId:job,externalId:'fixture-post',metadata:{privateMarker}});
  await sql`insert into publications(id,tenant_id,job_id,provider,reference,url,published_at) values(${publication},${tenant},${job},'telegram',${pubReference}::jsonb,'javascript:alert(1)','2025-01-01T12:01:00Z')`;
  const recentSnapshot=JSON.stringify({...snapshot,title:'Recent publication',caption:'Other saved text'});
  await sql`with added as (insert into publishing_jobs(tenant_id,brand_id,calendar_id,calendar_revision,content_item_id,connection_id,credential_version,provider,snapshot,status,scheduled_at,next_attempt_at,idempotency_key,input_hash,approved_by,correlation_id) select ${tenant},${brand},${calendar},n,${content},${connection},1,'telegram',${recentSnapshot}::jsonb,'PUBLISHED',now(),now(),gen_random_uuid(),'fixture',${user},gen_random_uuid() from generate_series(1,101)n returning id) insert into publications(tenant_id,job_id,provider,reference,published_at) select ${tenant},id,'telegram',jsonb_build_object('provider','telegram','internalId',id,'externalId',id),now() from added`;
  return {user,outsider,tenant,foreign,brand,otherBrand,publication,job,content,title,contentTitle,needle,caption,privateMarker};
}
