import {randomUUID} from 'node:crypto';
import type {createDatabase} from '../../packages/db/src/index';
/** Disposable test-only rows; no jobs, provider calls or approval mutations. */
export async function scriptDetailFixture(sql:ReturnType<typeof createDatabase>['client']){
  const user=randomUUID(),outsider=randomUUID(),tenant=randomUUID(),foreign=randomUUID(),brand=randomUUID(),otherBrand=randomUUID(),script=randomUUID();
  const title=`Exact script ${randomUUID()}`;
  for(const id of [user,outsider])await sql`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Script reader','unusable',now())`;
  for(const id of [tenant,foreign]){await sql`insert into organizations(id,name) values(${id},'Script detail fixture')`;await sql`insert into workspaces(id,tenant_id,name) values(${id},${id},'Workspace')`;await sql`insert into organization_members(tenant_id,user_id,role) values(${id},${user},'VIEWER')`;}
  for(const id of [brand,otherBrand])await sql`insert into brands(id,tenant_id,workspace_id,name) values(${id},${tenant},${tenant},'Script detail brand')`;
  await sql`insert into brands(id,tenant_id,workspace_id,name) values(${foreign},${foreign},${foreign},'Foreign brand')`;
  await sql`insert into content_items(id,tenant_id,brand_id,title,type) values(${script},${tenant},${brand},${title},'POST')`;
  await sql`insert into scripts(id,tenant_id,brand_id,content_item_id,current_version,approved_version,approved_by,platform,duration,created_at) values(${script},${tenant},${brand},${script},2,1,${user},'TELEGRAM',30,now()-interval '1 year')`;
  const current={hook:'Exact current hook <script>alert(1)</script>',context:'Current context',core:'Current body '+('longword'.repeat(100)),proof:'Verify the evidence',cta:'Read more',factCheckNotes:['Check this claim <img src=x onerror=alert(1)>']};
  for(const version of [1,2])await sql`insert into script_versions(tenant_id,script_id,version,content,created_by) values(${tenant},${script},${version},${JSON.stringify(version===2?current:{...current,hook:'Historical hook'})}::jsonb,${user})`;
  await sql`with added as (insert into content_items(tenant_id,brand_id,title,type) select ${tenant},${brand},'Recent script '||n,'POST' from generate_series(1,101)n returning id) insert into scripts(id,tenant_id,brand_id,content_item_id,current_version,platform,duration) select id,${tenant},${brand},id,1,'TELEGRAM',30 from added`;
  await sql`insert into script_versions(tenant_id,script_id,version,content,created_by) select ${tenant},id,1,${JSON.stringify({...current,hook:'Recent hook'})}::jsonb,${user} from scripts where tenant_id=${tenant} and brand_id=${brand} and id<>${script}`;
  return {user,outsider,tenant,foreign,brand,otherBrand,script,title,current};
}
