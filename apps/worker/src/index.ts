import { createServer } from 'node:http';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { parseServerEnvironment } from '@contentos/config';
import { createDatabase, JobRepository, AICallRepository, MediaRepository } from '@contentos/db';
import { MediaService } from '@contentos/core';
import { DomainError, workflowSchemas } from '@contentos/types';
import { GenerationOrchestrator } from '@contentos/ai';
import { OpenAILLMProvider, MockLLMProvider, storageFromEnvironment } from '@contentos/providers';

const env = parseServerEnvironment(process.env);
const database = createDatabase(env.DATABASE_URL);
const repository = new JobRepository(database.db);
const storage = storageFromEnvironment(env);
const media = new MediaService(new MediaRepository(database.db),storage);
const connection = new Redis(env.REDIS_URL,{maxRetriesPerRequest:null});
const queue = new Queue('contentos-generation',{connection});
const routes = env.AI_PROVIDER === 'mock' ? [{provider:new MockLLMProvider(env.NODE_ENV),model:'mock-v1'}] : env.AI_PROVIDER === 'openai' && env.OPENAI_API_KEY && env.OPENAI_MODEL ? [{provider:new OpenAILLMProvider(env.OPENAI_API_KEY),model:env.OPENAI_MODEL}] : [];
const orchestrator = new GenerationOrchestrator(routes);
const worker = new Worker<{tenantId:string;id:string}>('contentos-generation', async delivery => {
  const job = await repository.claim(delivery.data.tenantId,delivery.data.id);
  if (!job?.leaseToken) return;
  const leaseToken = job.leaseToken;
  const abort = new AbortController();
  const heartbeat = setInterval(() => { void repository.heartbeat(job.tenantId,job.id,leaseToken).then(owned => {if (!owned) abort.abort();}).catch(()=>abort.abort()); },30_000);
  const calls = new AICallRepository(database.db,job);
  try {
    if (!routes.some(route=>route.provider.name === job.provider && route.model === job.model)) throw new DomainError('CONFIGURATION_REQUIRED',503);
    const cached = (await calls.cached()).map(row=>workflowSchemas[job.type].safeParse(row.output)).find(result=>result.success);
    const output = cached?.success ? cached.data : await orchestrator.run(job.type,job.input,{internalId:job.id,tenantId:job.tenantId,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal:abort.signal},calls);
    await repository.complete(job.tenantId,job.id,leaseToken,output);
    console.log(JSON.stringify({event:'job_completed',jobId:job.id,correlationId:job.correlationId,provider:job.provider,attempt:job.attempt}));
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'PROVIDER_UNAVAILABLE';
    try { await repository.fail(job.tenantId,job.id,leaseToken,code,code === 'PROVIDER_UNAVAILABLE'); }
    catch (failure) { if (!(failure instanceof DomainError && failure.code === 'CONFLICT')) throw failure; }
    console.log(JSON.stringify({event:'job_error',jobId:job.id,correlationId:job.correlationId,code}));
  } finally { clearInterval(heartbeat); }
},{connection,concurrency:3});
worker.on('error',()=>console.error(JSON.stringify({event:'worker_error',code:'QUEUE_UNAVAILABLE'})));
connection.on('error',()=>console.error(JSON.stringify({event:'redis_error',code:'QUEUE_UNAVAILABLE'})));
let dispatching = false;
async function dispatch() {
  if (dispatching) return;
  dispatching = true;
  try {
    for (const job of await repository.due()) {
      await queue.add('generate',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await repository.dispatched(job.tenantId,job.id);
    }
  } catch { console.error(JSON.stringify({event:'dispatch_error',code:'QUEUE_UNAVAILABLE'})); }
  finally { dispatching = false; }
}
const health = process.env.WORKER_HEALTH_PORT ? createServer((request,response)=> {
  if (request.url !== '/health') {response.writeHead(404);response.end();return;}
  const ready = connection.status === 'ready' && worker.isRunning();
  response.writeHead(ready?200:503, {'Content-Type':'application/json'});response.end(JSON.stringify({status:ready?'ok':'unavailable'}));
}) : null;
if (health) health.listen(Number(process.env.WORKER_HEALTH_PORT),'127.0.0.1');
const timer = setInterval(()=>void dispatch(),2000);
let cleaning = false;
let cleanupTask: Promise<void> = Promise.resolve();
const cleanupTimer = setInterval(() => {
  if (cleaning) return;
  cleaning = true;
  cleanupTask = media.cleanupOne().then(()=>{}).catch(()=>console.error(JSON.stringify({event:'media_cleanup_error',code:'PROVIDER_UNAVAILABLE'}))).finally(()=>{cleaning=false;});
},2000);
void dispatch();
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  clearInterval(timer); clearInterval(cleanupTimer); health?.close(); await worker.close(); await cleanupTask; await queue.close(); await connection.quit(); storage?.close(); await database.close();
}
process.on('SIGTERM',()=>void stop()); process.on('SIGINT',()=>void stop());
console.log(JSON.stringify({event:'worker_started',provider:env.AI_PROVIDER}));
