// Synthetic test-only pipeline. Real queues/DB/FFmpeg/S3/SMTP, NOT full production processors.
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Worker,Queue} from 'bullmq';
import {Redis} from 'ioredis';
import {createDatabase,JobRepository,LedgerRepository} from '../../../packages/db/src/index';
import {S3StorageProvider,FFmpegMediaPreparation,SmtpEmailProvider} from '../../../packages/providers/src/index';
import {emptyOnboarding,generationOptionsSchema} from '../../../packages/types/src/index';
import {prepareBenchmarkBucket} from '../../../packages/providers/test/benchmark-bucket';
import {createHeavyTaskGate,parseWorkerResourceProfile,drainHeavyWorkers} from '../src/resource-profile';
const exec=promisify(execFile),hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function main(){
  if(process.env.NODE_ENV!=='test'||process.env.CONTENTOS_BENCHMARK!=='synthetic-only'||process.env.DATABASE_URL!=='postgresql://contentos:fixture-only@postgres:5432/contentos_benchmark_test'||process.env.REDIS_URL!=='redis://redis:6379/14')throw new Error('Fixture configuration required');
  const mode=parseWorkerResourceProfile(process.env.WORKER_RESOURCE_PROFILE),run=createHeavyTaskGate(mode);
  const db=createDatabase(process.env.DATABASE_URL),repo=new JobRepository(db.db),ledger=new LedgerRepository(db.db),redis=new Redis(process.env.REDIS_URL,{maxRetriesPerRequest:null});
  await prepareBenchmarkBucket();
  const storage=new S3StorageProvider({endpoint:'http://127.0.0.1:9000',region:'us-east-1',bucket:'contentos-benchmark',accessKeyId:'fixture-access',secretAccessKey:'fixture-secret-not-production',forcePathStyle:true,production:false});
  const media=new FFmpegMediaPreparation('/usr/bin/ffmpeg','/usr/bin/ffprobe'),smtp=new SmtpEmailProvider('smtp://smtp:1025','fixture@example.test',false);
  const tenant=randomUUID(),user=randomUUID(),workspace=randomUUID(),brand=randomUUID(),correlation=randomUUID();
  await db.client`insert into users(id,email,password_hash,name,email_verified_at) values(${user},${`${user}@example.test`},'unusable','Fixture',now())`;
  await db.client`insert into organizations(id,name) values(${tenant},'Benchmark')`;
  await db.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${user},'OWNER')`;
  await db.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenant},'Fixture')`;
  await db.client`insert into brands(id,tenant_id,workspace_id,name,onboarding_completed_at) values(${brand},${tenant},${workspace},'Fixture',now())`;
  await ledger.adjust(tenant,'AI_CREDITS',100,'benchmark-funding',correlation);
  const directory=await mkdtemp(join(tmpdir(),'benchmark-'));
  const sourceFile=join(directory,'source.mp4');
  await exec('/usr/bin/ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=1920x1080:r=30:d=6','-f','lavfi','-i','sine=frequency=440:duration=6','-c:v','libx264','-threads','1','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-shortest','-map_metadata','-1','-fflags','+bitexact','-flags:v','+bitexact',sourceFile],{timeout:120000,maxBuffer:65536});
  const source=await readFile(sourceFile),sourceHash=hash(source),sourceKey=`${tenant}/fixture/source.mp4`;
  const context=(id:string)=>({tenantId:tenant,internalId:id,idempotencyKey:id,correlationId:correlation,signal:AbortSignal.timeout(120000)});
  await storage.put(sourceKey,source,'video/mp4',context(correlation));await rm(directory,{recursive:true});
  const queues=Array.from({length:4},(_,i)=>new Queue(`benchmark-${tenant}-${i}`,{connection:redis}));
  let started=0,finished=0,admitted=0,active=0,peakActive=0,stopping=false,shutdownMs:number|null=null;const results:Array<{id:string;durationMs:number;latencyMs:number;bytes:number;hash:string;mimeType:string;width:number|null;height:number|null;duration:number}> = [],errors:string[]=[];
  const workers=queues.map((queue,i)=>new Worker<{id:string}>(queue.name,delivery=>{admitted++;return run(async()=>{
    const began=performance.now(),claim=await repo.claim(tenant,delivery.data.id);if(!claim?.leaseToken)throw new Error('Claim mismatch');
    active++;peakActive=Math.max(peakActive,active);
    try{
      const input=await storage.get(sourceKey,64*1024*1024,context(claim.id));
      const out=await media.prepare({bytes:input,mimeType:'video/mp4'},context(claim.id));
      const key=`${tenant}/fixture/${claim.id}.mp4`;await storage.put(key,out.bytes,out.mimeType,context(claim.id));
      const restored=await storage.get(key,64*1024*1024,context(claim.id));if(hash(restored)!==hash(out.bytes))throw new Error('Object roundtrip mismatch');
      await smtp.send({recipient:'sink@example.test',subject:'Synthetic benchmark',text:'Synthetic output ready'},context(claim.id));
      await repo.complete(tenant,claim.id,claim.leaseToken,{hook:'Test hook',context:'Context',core:'Core',proof:'Verify this',cta:'Learn more',factCheckNotes:[]});
      results.push({id:claim.id,durationMs:performance.now()-began,latencyMs:performance.now()-started,bytes:out.bytes.byteLength,hash:hash(out.bytes),mimeType:out.mimeType,width:out.width,height:out.height,duration:out.durationMs});finished++;
    }finally{active--;}
  });},{connection:redis,concurrency:i===0?3:1}));
  for(const worker of workers){worker.on('error',()=>errors.push('QUEUE_ERROR'));worker.on('failed',()=>errors.push('PROCESSOR_FAILED'));worker.on('stalled',()=>errors.push('QUEUE_STALLED'));}
  const summary=()=>({event:'benchmark_result',mode,sourceHash,sourceBytes:source.byteLength,count:6,finished,admitted,active,peakActive,elapsedMs:started?performance.now()-started:0,shutdownMs,results,errors,scope:'synthetic-pipeline-not-production-entrypoint'});
  const server=createServer((request,response)=>{void (async()=>{
    if(request.url==='/run'&&request.method==='POST'&&!started&&!stopping){
      started=performance.now();
      for(let i=0;i<6;i++){
        const job=await repo.enqueue(user,tenant,brand,'GENERATE_SCRIPT',{brain:emptyOnboarding('Fixture'),options:generationOptionsSchema.parse({}),brandRevision:0},randomUUID(),'mock','mock-v1',correlation);
        await queues[i<3?0:i-2]!.add('fixture',{id:job.id},{jobId:job.id,attempts:1});
      }
      response.end('queued');return;
    }
    if(request.url==='/status'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(summary()));return;}
    response.statusCode=409;response.end('fixture request refused');
  })().catch(()=>{errors.push('REQUEST_FAILED');response.statusCode=500;response.end('fixture failed');});});
  server.listen(3191,'127.0.0.1');
  process.once('SIGTERM',()=>{void (async()=>{
    stopping=true;const began=performance.now();await drainHeavyWorkers(workers);shutdownMs=performance.now()-began;
    const rows=await db.client`select status,attempt from jobs where tenant_id=${tenant}`;
    if(rows.length!==6||rows.some(row=>row.status!=='SUCCEEDED'||row.attempt!==1)||finished!==6||errors.length)throw new Error('Terminal correctness mismatch');
    console.log(JSON.stringify(summary()));server.close();await Promise.all(queues.map(queue=>queue.close()));await redis.quit();storage.close();await db.close();
  })().catch(()=>{console.error('benchmark_shutdown_failed');process.exitCode=1;process.exit(1);});});
}
main().catch(()=>{console.error('benchmark_startup_failed');process.exitCode=1;});
