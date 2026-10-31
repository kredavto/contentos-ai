import postgres from 'postgres';
/** Dedicated bounded SELECT-only connection; never borrows an application transaction. */
export async function probeDatabase(url:string,signal:AbortSignal):Promise<void>{
 signal.throwIfAborted();
 const client=postgres(url,{max:1,prepare:false,idle_timeout:1,connect_timeout:1,connection:{statement_timeout:1000}}),query=client`select 1 as ready`;
 const abort=()=>query.cancel();signal.addEventListener('abort',abort,{once:true});
 try{const [row]=await query;signal.throwIfAborted();if(row?.ready!==1)throw new Error('Database probe unavailable');}
 finally{signal.removeEventListener('abort',abort);await client.end({timeout:0});}
}
