import { createServer } from 'node:http';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { parseServerEnvironment } from '@contentos/config';
import { BillingRepository, PaymentTaskRepository, ChannelAnalyticsRepository, createDatabase, JobRepository, AICallRepository, MediaRepository, AvatarRepository, VideoRepository, PublishingRepository } from '@contentos/db';
import { PaymentProcessor, ChannelAnalyticsProcessor, MediaService, AvatarService, AvatarProcessor, VideoProcessor, VideoService, PublishingProcessor, credentialVaultFromEnvironment } from '@contentos/core';
import { DomainError, workflowSchemas, generationInputSchema, validatePerformanceOutput, type JobType } from '@contentos/types';
import { GenerationOrchestrator } from '@contentos/ai';
import { paymentsFromEnvironment, channelAnalyticsFromEnvironment, OpenAILLMProvider, MockLLMProvider, storageFromEnvironment, avatarFromEnvironment, videoFromEnvironment, captionsFromEnvironment, FFmpegVideoProcessor, publishingFromEnvironment, socialFromEnvironment } from '@contentos/providers';

const env = parseServerEnvironment(process.env);
const database = createDatabase(env.DATABASE_URL);
const repository = new JobRepository(database.db);
const storage = storageFromEnvironment(env);
const media = new MediaService(new MediaRepository(database.db),storage);
const avatarConnection = avatarFromEnvironment(env);
const avatars = new AvatarService(new AvatarRepository(database.db),avatarConnection,storage,env.AVATAR_GENERATION_ENABLED==='true');
const avatarProcessor = new AvatarProcessor(database.db,avatarConnection,storage,env.AVATAR_GENERATION_ENABLED==='true');
const videoConnection=videoFromEnvironment(env);
const videos=new VideoService(new VideoRepository(database.db),videoConnection,storage,env.VIDEO_GENERATION_ENABLED==='true',captionsFromEnvironment(env));
const videoProcessor = new VideoProcessor(database.db,videoConnection,storage,env.FFMPEG_PATH&&env.FFPROBE_PATH?new FFmpegVideoProcessor(env.FFMPEG_PATH,env.FFPROBE_PATH):null,env.VIDEO_GENERATION_ENABLED==='true',captionsFromEnvironment(env));
const connection = new Redis(env.REDIS_URL,{maxRetriesPerRequest:null});
const queue = new Queue('contentos-generation',{connection});
const channelAnalyticsRepository=new ChannelAnalyticsRepository(database.db);
const channelAnalyticsProcessor=new ChannelAnalyticsProcessor(channelAnalyticsRepository,channelAnalyticsFromEnvironment(env),credentialVaultFromEnvironment(env));
const paymentRepository = new PaymentTaskRepository(database.db);
const paymentProvider = paymentsFromEnvironment(env);
const paymentProcessor = new PaymentProcessor(paymentRepository, new BillingRepository(database.db), paymentProvider, paymentProvider && env.YOOKASSA_SHOP_ID ? { provider: paymentProvider.name, merchantId: env.YOOKASSA_SHOP_ID, test: env.YOOKASSA_TEST_MODE === 'true' } : null, credentialVaultFromEnvironment(env));
const paymentQueue = new Queue('contentos-payments', { connection });
const paymentWorker = new Worker<{tenantId:string;id:string}>('contentos-payments', delivery => paymentProcessor.run(delivery.data.tenantId, delivery.data.id), { connection, concurrency: 2 });
paymentWorker.on('error', () => console.error(JSON.stringify({ event: 'payment_worker_error', code: 'QUEUE_UNAVAILABLE' })));
const analyticsQueue=new Queue('contentos-analytics',{connection});
const analyticsWorker=new Worker<{tenantId:string;id:string}>('contentos-analytics',delivery=>channelAnalyticsProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:2});
analyticsWorker.on('error',()=>console.error(JSON.stringify({event:'analytics_worker_error',code:'QUEUE_UNAVAILABLE'})));
const publishingRepository=new PublishingRepository(database.db);
const publishingProcessor=new PublishingProcessor(publishingRepository,publishingFromEnvironment(env),socialFromEnvironment(env),credentialVaultFromEnvironment(env),storage);
const publishingQueue=new Queue('contentos-publishing',{connection});
const publishingWorker=new Worker<{tenantId:string;id:string}>('contentos-publishing',delivery=>publishingProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:2});
publishingWorker.on('error',()=>console.error(JSON.stringify({event:'publishing_worker_error',code:'QUEUE_UNAVAILABLE'})));
const routes = env.AI_PROVIDER === 'mock' ? [{provider:new MockLLMProvider(env.NODE_ENV),model:'mock-v1'}] : env.AI_PROVIDER === 'openai' && env.OPENAI_API_KEY && env.OPENAI_MODEL ? [{provider:new OpenAILLMProvider(env.OPENAI_API_KEY),model:env.OPENAI_MODEL}] : [];
const orchestrator = new GenerationOrchestrator(routes);
const worker = new Worker<{tenantId:string;id:string;type:JobType}>('contentos-generation', async delivery => {
  if(delivery.data.type==='GENERATE_VIDEO'){await videoProcessor.run(delivery.data.tenantId,delivery.data.id);return;}
  if(delivery.data.type==='CREATE_AVATAR'){await avatarProcessor.run(delivery.data.tenantId,delivery.data.id);return;}
  const job = await repository.claim(delivery.data.tenantId,delivery.data.id);
  if (!job?.leaseToken || (job.type === 'CREATE_AVATAR' || job.type === 'GENERATE_VIDEO')) return;
  const leaseToken = job.leaseToken;
  const workflowType = job.type;
  const abort = new AbortController();
  const heartbeat = setInterval(() => { void repository.heartbeat(job.tenantId,job.id,leaseToken).then(owned => {if (!owned) abort.abort();}).catch(()=>abort.abort()); },30_000);
  const calls = new AICallRepository(database.db,job);
  try {
    if (!routes.some(route=>route.provider.name === job.provider && route.model === job.model)) throw new DomainError('CONFIGURATION_REQUIRED',503);
    if(workflowType==='OPTIMIZE_STRATEGY'&&env.ANALYTICS_AI_ENABLED!=='true')throw new DomainError('CONFIGURATION_REQUIRED',503);
    const input=generationInputSchema.parse(job.input);
    if(workflowType==='OPTIMIZE_STRATEGY'&&!input.performance)throw new DomainError('INVALID_INPUT');
    const cached = (await calls.cached()).map(row=>workflowType==='OPTIMIZE_STRATEGY'?validatePerformanceOutput(row.output,input.performance!.evidence):workflowSchemas[workflowType].safeParse(row.output)).find(result=>result.success);
    const output = cached?.success ? cached.data : await orchestrator.run(workflowType,input,{internalId:job.id,tenantId:job.tenantId,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal:abort.signal},calls);
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
    if (paymentProvider) for (const task of await paymentRepository.dispatchable()) {
      await paymentQueue.add('payment', task, { jobId: task.id, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: true });
      await paymentRepository.dispatched(task.tenantId, task.id);
    }
    for(const job of await channelAnalyticsRepository.due()){
      await analyticsQueue.add('fetch',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await channelAnalyticsRepository.dispatched(job.tenantId,job.id);
    }
    for(const job of await publishingRepository.due()){
      await publishingQueue.add('publish',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await publishingRepository.dispatched(job.tenantId,job.id);
    }
    for (const job of await repository.due()) {
      await queue.add('generate',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await repository.dispatched(job.tenantId,job.id);
    }
  } catch { console.error(JSON.stringify({event:'dispatch_error',code:'QUEUE_UNAVAILABLE'})); }
  finally { dispatching = false; }
}
const health = process.env.WORKER_HEALTH_PORT ? createServer((request,response)=> {
  if (request.url !== '/health') {response.writeHead(404);response.end();return;}
  const ready = connection.status === 'ready' && worker.isRunning() && publishingWorker.isRunning() && analyticsWorker.isRunning() && paymentWorker.isRunning();
  response.writeHead(ready?200:503, {'Content-Type':'application/json'});response.end(JSON.stringify({status:ready?'ok':'unavailable'}));
}) : null;
if (health) health.listen(Number(process.env.WORKER_HEALTH_PORT),'127.0.0.1');
const timer = setInterval(()=>void dispatch(),2000);
let cleaning = false;
let cleanupTask: Promise<void> = Promise.resolve();
const cleanupTimer = setInterval(() => {
  if (cleaning) return;
  cleaning = true;
  cleanupTask = media.cleanupOne().then(()=>{}).catch(()=>console.error(JSON.stringify({event:'media_cleanup_error',code:'PROVIDER_UNAVAILABLE'}))).then(()=>avatars.cleanupOne()).then(()=>{}).catch(()=>console.error(JSON.stringify({event:'avatar_cleanup_error',code:'PROVIDER_UNAVAILABLE'}))).then(()=>videos.cleanupOne()).then(()=>{}).catch(()=>console.error(JSON.stringify({event:'video_cleanup_error',code:'PROVIDER_UNAVAILABLE'}))).finally(()=>{cleaning=false;});
},2000);
void dispatch();
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  clearInterval(timer); clearInterval(cleanupTimer); health?.close(); await worker.close(); await publishingWorker.close(); await analyticsWorker.close(); await paymentWorker.close(); await cleanupTask; await queue.close(); await publishingQueue.close(); await analyticsQueue.close(); await paymentQueue.close(); await connection.quit(); storage?.close(); await database.close();
}
process.on('SIGTERM',()=>void stop()); process.on('SIGINT',()=>void stop());
console.log(JSON.stringify({event:'worker_started',provider:env.AI_PROVIDER}));
