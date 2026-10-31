import {randomUUID} from 'node:crypto';
import type {createDatabase} from '../../packages/db/src/index';
/** Disposable database-only fixture; terminal job cannot be claimed by a worker. */
export async function ideaDetailFixture(sql:ReturnType<typeof createDatabase>['client']){
  const user=randomUUID(),outsider=randomUUID(),tenant=randomUUID(),foreign=randomUUID(),brand=randomUUID(),otherBrand=randomUUID(),idea=randomUUID(),reservation=randomUUID(),job=randomUUID();
  const title=`Exact idea ${randomUUID()}`,hook='Saved hook <script>alert(1)</script>',angle='Long angle '+('longword'.repeat(100));
  for(const id of [user,outsider])await sql`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Idea reader','unusable',now())`;
  for(const id of [tenant,foreign]){await sql`insert into organizations(id,name) values(${id},'Idea fixture')`;await sql`insert into workspaces(id,tenant_id,name) values(${id},${id},'Workspace')`;await sql`insert into organization_members(tenant_id,user_id,role) values(${id},${user},'VIEWER')`;}
  for(const id of [brand,otherBrand])await sql`insert into brands(id,tenant_id,workspace_id,name) values(${id},${tenant},${tenant},'Idea brand')`;
  await sql`insert into brands(id,tenant_id,workspace_id,name) values(${foreign},${foreign},${foreign},'Foreign brand')`;
  await sql`insert into usage_reservations(id,tenant_id,key,unit,amount) values(${reservation},${tenant},'idea fixture','AI_CREDITS',1)`;
  await sql`insert into jobs(id,tenant_id,brand_id,requested_by,type,status,input,input_hash,idempotency_key,reservation_id,provider,model,correlation_id) values(${job},${tenant},${brand},${user},'GENERATE_IDEAS','SUCCEEDED','{}','fixture',${randomUUID()},${reservation},'mock','mock',${randomUUID()})`;
  await sql`insert into ideas(id,tenant_id,brand_id,job_id,ordinal,title,angle,hook,audience_label,pillar_label,funnel_stage,platform,format,score,scores,rationale,source,created_at) values(${idea},${tenant},${brand},${job},0,${title},${angle},${hook},'Audience','Pillar','AWARENESS','TELEGRAM','POST',75,'{"relevance":75,"<img src=x onerror=alert(1)>":1}','Rationale <img src=x onerror=alert(1)>','mock',now()-interval '1 year')`;
  await sql`insert into ideas(tenant_id,brand_id,job_id,ordinal,title,angle,hook,audience_label,pillar_label,funnel_stage,platform,format,score,scores,rationale,source) select ${tenant},${brand},${job},n,'Recent idea '||n,'Angle','Hook','Audience','Pillar','AWARENESS','TELEGRAM','POST',1,'{}','Fixture','mock' from generate_series(1,101)n`;
  return {user,outsider,tenant,foreign,brand,otherBrand,idea,title,hook,angle,job};
}
