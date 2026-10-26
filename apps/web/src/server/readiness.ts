import {ReadinessService,type ReadinessProbe} from '@contentos/core';
import {probeDatabase} from '@contentos/db';
import {probeRedis,storageFromEnvironment} from '@contentos/providers';
function endpoint(value:string|undefined,protocols:readonly string[]):string|null{
 if(!value||value.length>8192)return null;
 try{const parsed=new URL(value);return protocols.includes(parsed.protocol)&&parsed.hostname&&!parsed.hash?value:null;}catch{return null;}
}
/** This narrow profile deliberately does not depend on external AI/payment/SMTP configuration. */
export function createReadinessService(env:Record<string,string|undefined>){
 const database=endpoint(env.DATABASE_URL,['postgres:','postgresql:']),redis=endpoint(env.REDIS_URL,['redis:','rediss:']);
 let storage:ReadinessProbe|undefined;
 try{const provider=storageFromEnvironment(env);if(provider)storage=signal=>provider.ready(signal);}
 catch{storage=undefined;/* Invalid infrastructure configuration is reported explicitly, without its private values. */}
 return new ReadinessService({...(database?{database:signal=>probeDatabase(database,signal)}:{}),...(redis?{redis:signal=>probeRedis(redis,signal)}:{}),...(storage?{storage}:{})});
}
let service:ReadinessService|undefined;
export function readinessService(){return service??=createReadinessService(process.env);}
