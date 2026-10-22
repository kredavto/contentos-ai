import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createDatabase,ContentRepository,LedgerRepository} from '../packages/db/src/index';
import {demoIds,seedDevelopment} from '../packages/db/src/development-seed';
import {assertRecoveryMatch,normalizeSchemaDump,recoveryConfiguration,snapshotDatabase} from './database-recovery-support';

// Internal test entry point: test:local owns the container and final cleanup.
const exec=promisify(execFile);
async function main(){
  const {url,container,docker}=recoveryConfiguration(process.env);
  const id=randomUUID().replaceAll('-',''),sourceName=`recovery_${id}_source_test`,targetName=`recovery_${id}_target_test`,referenceName=`recovery_${id}_schema_test`,archive=`/tmp/recovery-${id}.dump`,schemaFile=`/tmp/recovery-${id}.sql`;
  const address=(name:string)=>{const copy=new URL(url);copy.pathname=`/${name}`;return copy.href;};
  async function command(args:string[]){
    try{return (await exec(docker,['exec',container,...args],{timeout:120000,maxBuffer:8*1024*1024,env:process.env})).stdout;}
    catch{throw new Error(`Recovery command failed: ${args[0]}`);}
  }
  const source=createDatabase(address(sourceName)),target=createDatabase(address(targetName));
  const started=Date.now();
  try{
    await command(['createdb','-U','contentos','--template=contentos_test',sourceName]);
    await seedDevelopment(source.db,`scrypt:v1:${'0'.repeat(32)}:${'0'.repeat(128)}`);
    const ledger=new LedgerRepository(source.db),correlation=randomUUID();
    const held=await ledger.reserve(demoIds.tenant,'AI_CREDITS',7,'recovery:held',correlation);
    const released=await ledger.reserve(demoIds.tenant,'AI_CREDITS',3,'recovery:released',correlation);
    await ledger.settle(demoIds.tenant,released.id,'RELEASE',correlation);
    const otherTenant=randomUUID();await source.client`insert into organizations(id,name) values (${otherTenant},'Recovery isolation fixture')`;
    const before=await snapshotDatabase(source);
    if(!before.tables.some(table=>table.name==='drizzle.__drizzle_migrations'&&table.rows>0))throw new Error('Missing migration history');
    const dumpSchema=(name:string)=>command(['pg_dump','-U','contentos','--schema-only','--dbname',name]);
    // Replay the source's standalone schema into an independent empty reference.
    // PostgreSQL reparses CHECK expressions (e.g. nested AND), so raw source
    // dump text is not stable across the first restore. Never strip parentheses.
    await command(['pg_dump','-U','contentos','--schema-only','--file',schemaFile,'--dbname',sourceName]);
    await command(['createdb','-U','contentos','--template=template0',referenceName]);
    await command(['psql','-X','-U','contentos','--set=ON_ERROR_STOP=1','--single-transaction','--file',schemaFile,'--dbname',referenceName]);
    const schema=normalizeSchemaDump(await dumpSchema(referenceName));
    await command(['pg_dump','-U','contentos','--format=custom','--file',archive,'--dbname',sourceName]);
    await command(['createdb','-U','contentos','--template=template0',targetName]);
    await command(['pg_restore','-U','contentos','--exit-on-error','--single-transaction','--dbname',targetName,archive]);
    assertRecoveryMatch(before,await snapshotDatabase(target));
    if(schema!==normalizeSchemaDump(await dumpSchema(targetName)))throw new Error('Restored schema differs from the source schema reference');
    // Applied migration history must make a normal deployment migration a no-op.
    try{await exec(process.execPath,[fileURLToPath(import.meta.resolve('tsx/cli')),'packages/db/src/migrate.ts'],{env:{...process.env,DATABASE_URL:address(targetName)},timeout:120000,maxBuffer:8*1024*1024});}
    catch{throw new Error('Migration check on restored database failed');}
    assertRecoveryMatch(before,await snapshotDatabase(target));
    if(schema!==normalizeSchemaDump(await dumpSchema(targetName)))throw new Error('Migration replay changed restored schema');
    async function rejectsSql(operation:()=>Promise<unknown>,code:string){
      try{await operation();}catch(error){if(error&&typeof error==='object'&&'code' in error&&error.code===code)return;throw new Error('Unexpected recovery constraint failure',{cause:error});}
      throw new Error('Restored database accepted a forbidden mutation');
    }
    await rejectsSql(()=>target.client`update usage_ledger set amount=amount where tenant_id=${demoIds.tenant}`,'23514');
    await rejectsSql(()=>target.client`delete from script_versions where script_id=${demoIds.script}`,'23514');
    await rejectsSql(()=>target.client`insert into content_items(tenant_id,brand_id,title,type,status) values (${otherTenant},${demoIds.brand},'Cross-tenant rejection','POST','SCRIPT')`,'23503');
    assertRecoveryMatch(before,await snapshotDatabase(target));
    const restoredLedger=new LedgerRepository(target.db);
    const balances=(await restoredLedger.overview(demoIds.user,demoIds.tenant)).balances;
    if(balances.AI_CREDITS.available!==92||balances.AI_CREDITS.reserved!==7)throw new Error('Restored balance is incorrect');
    await Promise.all([1,2].map(()=>restoredLedger.settle(demoIds.tenant,held.id,'CAPTURE',correlation)));
    const after=(await restoredLedger.overview(demoIds.user,demoIds.tenant)).balances;
    if(after.AI_CREDITS.available!==92||after.AI_CREDITS.reserved!==0)throw new Error('Restored reservation cannot settle idempotently');
    await new ContentRepository(target.db).editScript(demoIds.user,demoIds.tenant,demoIds.brand,demoIds.script,1,null,correlation);
    const versions=await target.client`select approved_version from scripts where id=${demoIds.script}`;
    if(versions[0]?.approved_version!==1)throw new Error('Restored content cannot be approved');
    // Operational probes may alter the target, never the source.
    assertRecoveryMatch(before,await snapshotDatabase(source));
    process.stdout.write(JSON.stringify({event:'database_recovery_verified',tables:before.tables.length,rows:before.tables.reduce((sum,table)=>sum+table.rows,0),sequences:before.sequences.length,durationMs:Date.now()-started})+'\n');
  }finally{await Promise.all([source.close(),target.close()]);}
}
try{await main();}catch(error){process.stderr.write(`Database recovery verification failed: ${error instanceof Error?error.message:'unknown failure'}\n`);process.exitCode=1;}
