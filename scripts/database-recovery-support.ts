import {createHash} from 'node:crypto';
import {createDatabase} from '../packages/db/src/index';

export function recoveryConfiguration(env:NodeJS.ProcessEnv){
  let url:URL;
  try{url=new URL(env.TEST_DATABASE_URL??'');}catch{throw new Error('Disposable recovery environment required');}
  const container=env.RECOVERY_CONTAINER??'',docker=env.RECOVERY_DOCKER??'',dockerHost=env.RECOVERY_DOCKER_HOST??'',owner=env.RECOVERY_OWNER??'';
  if(env.NODE_ENV!=='test'||!/^contentos-test-[a-f0-9]{12}-db$/.test(container)||!docker.startsWith('/')||!dockerHost.startsWith('unix:///')||owner!==container.slice(0,-3)||!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!=='127.0.0.1'||url.pathname!=='/contentos_test'||url.username!=='contentos'||!url.port||url.search||url.hash)throw new Error('Disposable recovery environment required');
  return {url,container,docker,dockerHost,owner};
}


// Only subprocess essentials; never inherit provider keys, PG options or Node preload hooks.
export function recoveryChildEnvironment(env:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  const result:NodeJS.ProcessEnv={NODE_ENV:'test'};
  for(const key of ['PATH','HOME','TMPDIR'] as const)if(env[key]!==undefined)result[key]=env[key];
  return result;
}
export function assertRecoveryOwnership(raw:string,configuration:ReturnType<typeof recoveryConfiguration>){
  try {
    const records=JSON.parse(raw);
    if(!Array.isArray(records)||records.length!==1)throw new Error();
    const record=records[0];
    const ports=record?.NetworkSettings?.Ports?.['5432/tcp'];
    if(record?.Name!==`/${configuration.container}`||record?.State?.Running!==true||
      record?.Config?.Image!=='postgres:17-alpine'||record?.Config?.Labels?.['contentos.test.owner']!==configuration.owner||
      !Array.isArray(ports)||ports.length!==1||ports[0]?.HostIp!=='127.0.0.1'||ports[0]?.HostPort!==configuration.url.port)throw new Error();
  }catch{throw new Error('Recovery ownership verification failed');}
}
export const recoveryStages=['configuration','ownership','fixture','snapshot','schema','dump_restore','migration_replay','integrity','source_unchanged'] as const;
export type RecoveryStage=typeof recoveryStages[number];
export function recoveryFailure(stage:RecoveryStage){return JSON.stringify({event:'database_recovery_failed',stage:recoveryStages.includes(stage)?stage:'configuration'});}

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
