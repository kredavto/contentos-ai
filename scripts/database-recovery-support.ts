import {createHash} from 'node:crypto';
import {createDatabase} from '../packages/db/src/index';

export function recoveryConfiguration(env:NodeJS.ProcessEnv){
  let url:URL;
  try{url=new URL(env.TEST_DATABASE_URL??'');}catch{throw new Error('Disposable recovery environment required');}
  const container=env.RECOVERY_CONTAINER??'',docker=env.RECOVERY_DOCKER??'';
  if(env.NODE_ENV!=='test'||!/^contentos-test-[a-f0-9]{12}-db$/.test(container)||!docker||!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/contentos_test'||url.username!=='contentos'||!url.port||url.search||url.hash)throw new Error('Disposable recovery environment required');
  return {url,container,docker};
}

// PostgreSQL adds a fresh psql restriction token to every textual dump.
export function normalizeSchemaDump(value:string){return value.split('\n').filter(line=>!/^\\(?:un)?restrict [A-Za-z0-9]+$/.test(line)).join('\n');}

export type RecoverySnapshot={tables:Array<{name:string;rows:number;hash:string}>;sequences:Array<{name:string;value:string;called:boolean}>};
export async function snapshotDatabase(database:ReturnType<typeof createDatabase>):Promise<RecoverySnapshot>{
  const sql=database.client;
  const relations=await sql<{schema:string;name:string;kind:string}[]>`select n.nspname as schema,c.relname as name,c.relkind as kind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','drizzle') and c.relkind in ('r','S') order by n.nspname,c.relname`;
  const result:RecoverySnapshot={tables:[],sequences:[]};
  for(const relation of relations){
    const name=`${relation.schema}.${relation.name}`;
    if(relation.kind==='S'){
      const [state]=await sql<{value:string;called:boolean}[]>`select last_value::text as value,is_called as called from ${sql(name)}`;
      if(!state)throw new Error('Missing recovery sequence');
      result.sequences.push({name,...state});
    }else{
      const rows=await sql<{value:string}[]>`select to_jsonb(t)::text as value from ${sql(name)} t order by to_jsonb(t)::text collate "C"`;
      const hash=createHash('sha256');for(const row of rows)hash.update(row.value).update('\n');
      result.tables.push({name,rows:rows.length,hash:hash.digest('hex')});
    }
  }
  return result;
}
export function assertRecoveryMatch(source:RecoverySnapshot,target:RecoverySnapshot){
  if(JSON.stringify(source)!==JSON.stringify(target))throw new Error('Restored data or sequences differ from the backup source');
}
