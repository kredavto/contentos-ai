import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {AccountErasureRepository} from '../../packages/db/src/repositories/account-erasures';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
type PlanNode={'Node Type'?:string;'Index Cond'?:string;Plans?:PlanNode[]};
describe.skipIf(!url)('indexed identity reference checks',()=>{
 const database=isolatedTestDatabase(url),erasure=new AccountErasureRepository(database.db);
 async function account(){const id=randomUUID();await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${id+'@example.test'},'Synthetic index fixture','unusable',now())`;return id;}
 it('has a valid leading B-tree lookup for every current single-column user FK, including nullable references',async()=>{
  const rows=await database.client<{table_name:string;column_name:string;indexed:boolean}[]>`
   select cl.relname as table_name,a.attname as column_name,
    exists(select 1 from pg_index i join pg_class ic on ic.oid=i.indexrelid join pg_am am on am.oid=ic.relam
     where i.indrelid=fk.conrelid and i.indisvalid and i.indisready and i.indkey[0]=a.attnum and am.amname='btree'
      and (i.indpred is null or pg_get_expr(i.indpred,i.indrelid)=format('(%I IS NOT NULL)',a.attname))) as indexed
   from pg_constraint fk join pg_class cl on cl.oid=fk.conrelid
   join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=fk.conkey[1]
   where fk.contype='f' and fk.confrelid='public.users'::regclass and cardinality(fk.conkey)=1`;
  expect(rows.length).toBeGreaterThan(0);expect(rows.filter(row=>!row.indexed).map(row=>row.table_name+'.'+row.column_name)).toEqual([]);
 });
 it('fails explicitly for references to another user identity column instead of comparing them to a UUID',async()=>{
  const id=await account();await database.client`create table unmapped_email_reference (user_email text references users(email))`;
  try{await database.client`insert into unmapped_email_reference values(${id+'@example.test'})`;await expect(erasure.eligibility(id)).rejects.toMatchObject({code:'CONFIGURATION_REQUIRED'});expect(await database.client`select id from users where id=${id} and erased_at is null and disabled_at is null`).toHaveLength(1);}
  finally{await database.client`drop table unmapped_email_reference`;}
 });
 it('uses an indexed absent-user lookup over retained history without forcing the planner or changing erasure eligibility',async()=>{
  const actor=await account(),target=await account(),absent=await account();
  await database.client`insert into platform_actions(actor_id,target_user_id,operation,reason,ticket,request_key,input_hash,revoked_sessions)
   select ${actor},${target},'REVOKE_SESSIONS','USER_REQUEST','INDEX-FIXTURE',gen_random_uuid(),repeat('a',64),0 from generate_series(1,20000)`;
  await database.client`analyze platform_actions`;
  const [row]=await database.client<{'QUERY PLAN':Array<{Plan:PlanNode;'Execution Time':number}>}[]>`explain(analyze,buffers,format json) select exists(select 1 from platform_actions where target_user_id=${absent}::uuid)`;
  const plan=row?.['QUERY PLAN'][0];expect(plan).toBeDefined();
  function indexed(node:PlanNode):boolean{return (/Index/.test(node['Node Type']??'')&&(node['Index Cond']??'').includes('target_user_id'))||(node.Plans??[]).some(indexed);}
  expect(indexed(plan!.Plan)).toBe(true);expect((await erasure.eligibility(absent)).eligible).toBe(true);
  console.log(JSON.stringify({event:'user_reference_lookup_verified',syntheticRows:20000,executionMs:plan!['Execution Time']}));
 });
});
