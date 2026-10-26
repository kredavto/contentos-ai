import {Redis} from 'ioredis';
/** No automatic reconnect, offline queue, subscriptions or server-info requests. */
export async function probeRedis(url:string,signal:AbortSignal):Promise<void>{
 signal.throwIfAborted();
 const client=new Redis(url,{lazyConnect:true,enableOfflineQueue:false,enableReadyCheck:false,disableClientInfo:true,maxRetriesPerRequest:0,retryStrategy:()=>null,connectTimeout:1000,commandTimeout:1000,autoResubscribe:false,autoResendUnfulfilledCommands:false});
 let failed=false;client.on('error',()=>{failed=true;});const abort=()=>client.disconnect(false);signal.addEventListener('abort',abort,{once:true});
 try{await client.connect();signal.throwIfAborted();if(await client.ping()!=='PONG'||failed)throw new Error('Redis probe unavailable');signal.throwIfAborted();}
 finally{signal.removeEventListener('abort',abort);client.disconnect(false);}
}
