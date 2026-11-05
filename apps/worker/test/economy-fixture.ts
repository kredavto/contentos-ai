// Disposable CI fixture. No real provider calls, production queues or ambient credentials.
import {randomUUID} from 'node:crypto';
import {Worker,Queue} from 'bullmq';
import {Redis} from 'ioredis';
import {createDatabase,JobRepository,LedgerRepository} from '../../../packages/db/src/index';
import {emptyOnboarding,generationOptionsSchema} from '../../../packages/types/src/index';
import {createHeavyTaskGate,drainHeavyWorkers} from '../src/resource-profile';
function send(value:object){process.send?.(value);}
function configuration(){
  const db=new URL(process.env.TEST_DATABASE_URL??''),redis=new URL(process.env.TEST_REDIS_URL??'');
  if(process.env.NODE_ENV!=='test'||!process.send||!['localhost','127.0.0.1'].includes(db.hostname)||db.pathname!=='/contentos_test'||!['postgres:','postgresql:'].includes(db.protocol)||db.search||db.hash||!['localhost','127.0.0.1'].includes(redis.hostname)||redis.protocol!=='redis:'||redis.pathname!=='/14'||redis.search||redis.hash)throw new Error('Fixture configuration required');
  return {db:db.href,redis:redis.href};
}
async function main(){
  const config=configuration(),database=createDatabase(config.db),connection=new Redis(config.redis,{maxRetriesPerRequest:null});
  const failFirst=process.argv[2]==='--fail-first';
  const prefix=`economy-fixture-${randomUUID()}`,queues=Array.from({length:4},(_,i)=>new Queue(`${prefix}-${i}`,{connection}));
  const workers:Worker[]=[];let release!:()=>void;
  const hold=new Promise<void>(resolve=>{release=resolve;}),gate=createHeavyTaskGate('economy');
  const jobs=new JobRepository(database.db),ledger=new LedgerRepository(database.db);
  const tenant=randomUUID(),user=randomUUID(),workspace=randomUUID(),brand=randomUUID(),correlation=randomUUID();
  const ids:string[]=[];let entered=0,active=0,peak=0,claims=0,stalled=0,stopping=false;
  try{
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${user},${`economy-${user}@example.test`},'unusable-fixture','Fixture',now())`;
    await database.client`insert into organizations(id,name) values(${tenant},'Economy fixture')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${user},'OWNER')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenant},'Fixture')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name,onboarding_completed_at) values(${brand},${tenant},${workspace},'Fixture',now())`;
    await ledger.adjust(tenant,'AI_CREDITS',100,'fixture-funding',correlation);
    const output={hook:'Test hook',context:'Context',core:'Core',proof:'Verify this',cta:'Learn more',factCheckNotes:[]};
    for(let i=0;i<6;i++){
      const job=await jobs.enqueue(user,tenant,brand,'GENERATE_SCRIPT',{brain:emptyOnboarding('Fixture'),options:generationOptionsSchema.parse({}),brandRevision:0},randomUUID(),'mock','mock-v1',correlation);
      ids.push(job.id);await queues[i<3?0:i-2]!.add('fixture',{id:job.id},{jobId:job.id,attempts:1,removeOnComplete:false});
    }
    for(let i=0;i<4;i++){
      const worker=new Worker(queues[i]!.name,delivery=>{
        entered++;if(entered===6)send({event:'accepted'});
        return gate(async()=>{
          const claim=await jobs.claim(tenant,delivery.data.id);
          if(!claim?.leaseToken)throw new Error('Fixture claim failed');
          claims++;active++;peak=Math.max(peak,active);
          try{await hold;if(failFirst&&claims===1){await jobs.fail(tenant,claim.id,claim.leaseToken,'PROVIDER_REJECTED',false);throw new Error('Fixture terminal failure');}await jobs.complete(tenant,claim.id,claim.leaseToken,output);}
          finally{active--;}
        });
      },{connection,concurrency:i===0?3:1,lockDuration:1000,lockRenewTime:250,stalledInterval:500});
      worker.on('stalled',()=>{stalled++;});worker.on('error',()=>send({event:'worker_error'}));workers.push(worker);
    }
    const messages=async(message:unknown)=>{
      if(message==='inspect'){
        const states:string[]=[],ttls:number[]=[],attempts:number[]=[];
        for(let i=0;i<6;i++){
          const queue=queues[i<3?0:i-2]!,job=await queue.getJob(ids[i]!);
          states.push(await job!.getState());ttls.push(await connection.pttl(`${queue.toKey(ids[i]!)}:lock`));attempts.push(job!.attemptsStarted);
        }
        const rows=await database.client`select status,attempt from jobs where tenant_id=${tenant}`;
        send({event:'inspection',states,ttls,attempts,rows,claims,peak,stalled});
      }else if(message==='release')release();
    };
    process.on('message',message=>{void messages(message).catch(()=>send({event:'fixture_error'}));});
    await new Promise<void>((resolve,reject)=>{
      process.once('SIGTERM',()=>{
        if(stopping)return;stopping=true;
        // Same helper used by production. Accepted callbacks still retain their locks.
        const draining=drainHeavyWorkers(workers);send({event:'stopping'});
        void draining.then(async()=>{
          const rows=await database.client`select status,attempt from jobs where tenant_id=${tenant}`;
          const states=await Promise.all(ids.map(async(id,i)=>(await queues[i<3?0:i-2]!.getJob(id))!.getState()));
          send({event:'drained',rows,states,claims,peak,stalled});resolve();
        }).catch(reject);
      });
    });
    for(const queue of queues)await queue.obliterate();
  }finally{
    release?.();await Promise.all(workers.map(worker=>worker.close()));await Promise.all(queues.map(queue=>queue.close()));await connection.quit();await database.close();
  }
  send({event:'cleaned'});
}
main().then(()=>{process.disconnect?.();}).catch(()=>{send({event:'fixture_error'});process.exitCode=1;process.disconnect?.();});
