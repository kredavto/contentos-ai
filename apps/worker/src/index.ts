import {errorReporterFromEnvironment} from '@contentos/providers/error-reporting';
import {randomUUID} from 'node:crypto';
import { createServer } from 'node:http';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { parseServerEnvironment } from '@contentos/config';
import { NotificationEmailRepository, YouTubeResolutionRepository, PublicationAnalyticsRepository, YouTubeUploadRepository, YouTubeOAuthRepository, SocialRepository, LibraryMediaRepository, ImageRepository, CoverRepository, EmailRepository, NotificationRepository, RenewalBillingRepository, PaymentWebhookRepository, BillingRepository, PaymentTaskRepository, ChannelAnalyticsRepository, createDatabase, JobRepository, AICallRepository, MediaRepository, AvatarRepository, VideoRepository, PublishingRepository } from '@contentos/db';
import { YouTubeResolutionService, YouTubeResolutionProcessor, PublicationAnalyticsProcessor, YouTubePublishingProcessor, YouTubeService, LibraryMediaProcessor, ImageProcessor, reportError, CoverProcessor, NotificationEmailProcessor, EmailProcessor, PaymentWebhookProcessor, PaymentProcessor, ChannelAnalyticsProcessor, MediaService, AvatarService, AvatarProcessor, VideoProcessor, VideoService, PublishingProcessor, credentialVaultFromEnvironment } from '@contentos/core';
import { DomainError, workflowSchemas, generationInputSchema, validatePerformanceOutput, validateBrandReview, type JobType } from '@contentos/types';
import { GenerationOrchestrator } from '@contentos/ai';
import {  youtubePublishingFromEnvironment, FFmpegMediaPreparation, SmtpEmailProvider, paymentsFromEnvironment, channelAnalyticsFromEnvironment, OpenAILLMProvider, MockLLMProvider, imageFromEnvironment, storageFromEnvironment, avatarFromEnvironment, videoFromEnvironment, captionsFromEnvironment, FFmpegVideoProcessor, publishingFromEnvironment, socialFromEnvironment } from '@contentos/providers';

const env = parseServerEnvironment(process.env);
const errors=errorReporterFromEnvironment(env,'worker');
function operationalError(event:string,code:string,error:unknown){const correlationId=randomUUID();console.error(JSON.stringify({event,code,correlationId}));reportError(errors,error,{correlationId,code});}
const database = createDatabase(env.DATABASE_URL);
const repository = new JobRepository(database.db);
const emailRepository=new EmailRepository(database.db);
const notificationEmailRepository=new NotificationEmailRepository(database.db);
const notificationEmailProcessor=new NotificationEmailProcessor(notificationEmailRepository,env.SMTP_URL&&env.EMAIL_FROM?new SmtpEmailProvider(env.SMTP_URL,env.EMAIL_FROM,env.NODE_ENV==='production'):null,env.APP_URL,env.APP_NAME,errors);
const emailProcessor=new EmailProcessor(emailRepository,env.SMTP_URL&&env.EMAIL_FROM?new SmtpEmailProvider(env.SMTP_URL,env.EMAIL_FROM,env.NODE_ENV==='production'):null,credentialVaultFromEnvironment(env),errors);
const storage = storageFromEnvironment(env);
const media = new MediaService(new MediaRepository(database.db),storage);
const libraryMediaRepository=new LibraryMediaRepository(database.db);
const libraryMediaProcessor=new LibraryMediaProcessor(libraryMediaRepository,storage,env.FFMPEG_PATH&&env.FFPROBE_PATH?new FFmpegMediaPreparation(env.FFMPEG_PATH,env.FFPROBE_PATH):null,env.MEDIA_LIBRARY_ENABLED==='true','s3',errors);
const avatarConnection = avatarFromEnvironment(env);
const avatars = new AvatarService(new AvatarRepository(database.db),avatarConnection,storage,env.AVATAR_GENERATION_ENABLED==='true',{vault:credentialVaultFromEnvironment(env)});
const avatarProcessor = new AvatarProcessor(database.db,avatarConnection,storage,env.AVATAR_GENERATION_ENABLED==='true',errors,{vault:credentialVaultFromEnvironment(env)});
const videoConnection=videoFromEnvironment(env);
const videos=new VideoService(new VideoRepository(database.db),videoConnection,storage,env.VIDEO_GENERATION_ENABLED==='true',captionsFromEnvironment(env));
const videoProcessor = new VideoProcessor(database.db,videoConnection,storage,env.FFMPEG_PATH&&env.FFPROBE_PATH?new FFmpegVideoProcessor(env.FFMPEG_PATH,env.FFPROBE_PATH):null,env.VIDEO_GENERATION_ENABLED==='true',captionsFromEnvironment(env),errors);
const connection = new Redis(env.REDIS_URL,{maxRetriesPerRequest:null});
const queue = new Queue('contentos-generation',{connection});
const libraryMediaQueue=new Queue('contentos-library-media',{connection});
const libraryMediaWorker=new Worker<{tenantId:string;id:string}>('contentos-library-media',delivery=>libraryMediaProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:1});
libraryMediaWorker.on('error',error=>operationalError('library_media_worker_error','QUEUE_UNAVAILABLE',error));
const imageRepository=new ImageRepository(database.db);
const imageProcessor=new ImageProcessor(imageRepository,imageFromEnvironment(env),storage,errors);
const imageQueue=new Queue('contentos-images',{connection});
const imageWorker=new Worker<{tenantId:string;id:string}>('contentos-images',delivery=>imageProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:1});
imageWorker.on('error',error=>operationalError('image_worker_error','QUEUE_UNAVAILABLE',error));
const coverRepository=new CoverRepository(database.db);
const coverProcessor=new CoverProcessor(coverRepository,storage,env.FFMPEG_PATH&&env.FFPROBE_PATH?new FFmpegVideoProcessor(env.FFMPEG_PATH,env.FFPROBE_PATH):null,errors);
const coverQueue=new Queue('contentos-covers',{connection});
const coverWorker=new Worker<{tenantId:string;id:string}>('contentos-covers',delivery=>coverProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:1});
coverWorker.on('error',error=>operationalError('cover_worker_error','QUEUE_UNAVAILABLE',error));
const channelAnalyticsRepository=new ChannelAnalyticsRepository(database.db);
const channelAnalyticsProcessor=new ChannelAnalyticsProcessor(channelAnalyticsRepository,channelAnalyticsFromEnvironment(env),credentialVaultFromEnvironment(env),errors);
const notificationRepository=new NotificationRepository(database.db);
const paymentRepository = new PaymentTaskRepository(database.db);
const paymentProvider = paymentsFromEnvironment(env);
const renewalRepository = new RenewalBillingRepository(database.db);
const renewalMerchant = paymentProvider && env.YOOKASSA_SHOP_ID ? {provider:'yookassa' as const,merchantId:env.YOOKASSA_SHOP_ID,test:env.YOOKASSA_TEST_MODE==='true'} : null;
const renewalVaultReady = Boolean(credentialVaultFromEnvironment(env));
const renewalFiscal = env.PAYMENT_RECEIPT_VAT_CODE && env.PAYMENT_RECEIPT_SUBJECT ? {vatCode:Number(env.PAYMENT_RECEIPT_VAT_CODE),subject:env.PAYMENT_RECEIPT_SUBJECT,mode:'full_payment' as const,...(env.PAYMENT_RECEIPT_TAX_SYSTEM_CODE?{taxSystemCode:Number(env.PAYMENT_RECEIPT_TAX_SYSTEM_CODE)}:{})} : null;
const paymentProcessor = new PaymentProcessor(paymentRepository, new BillingRepository(database.db), paymentProvider, paymentProvider && env.YOOKASSA_SHOP_ID ? { provider: paymentProvider.name, merchantId: env.YOOKASSA_SHOP_ID, test: env.YOOKASSA_TEST_MODE === 'true' } : null, credentialVaultFromEnvironment(env), env.PAYMENT_RENEWALS_ENABLED==='true',errors);
const paymentWebhookRepository=new PaymentWebhookRepository(database.db);
const paymentWebhookProcessor=new PaymentWebhookProcessor(paymentWebhookRepository,new BillingRepository(database.db),paymentProvider,paymentProvider&&env.YOOKASSA_SHOP_ID?{provider:paymentProvider.name,merchantId:env.YOOKASSA_SHOP_ID,test:env.YOOKASSA_TEST_MODE==='true'}:null,credentialVaultFromEnvironment(env),errors);
const paymentQueue = new Queue('contentos-payments', { connection });
const paymentWorker = new Worker<{tenantId:string;id:string}>('contentos-payments', delivery => delivery.name==='webhook'?paymentWebhookProcessor.run(delivery.data.id):paymentProcessor.run(delivery.data.tenantId, delivery.data.id), { connection, concurrency: 2 });
paymentWorker.on('error',error=>operationalError('payment_worker_error','QUEUE_UNAVAILABLE',error));
const analyticsQueue=new Queue('contentos-analytics',{connection});
const analyticsWorker=new Worker<{tenantId:string;id:string}>('contentos-analytics',delivery=>channelAnalyticsProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:2});
analyticsWorker.on('error',error=>operationalError('analytics_worker_error','QUEUE_UNAVAILABLE',error));
const publishingRepository=new PublishingRepository(database.db);
const publishingProcessor=new PublishingProcessor(publishingRepository,publishingFromEnvironment(env),socialFromEnvironment(env),credentialVaultFromEnvironment(env),storage,errors);
const publishingQueue=new Queue('contentos-publishing',{connection});
const publishingWorker=new Worker<{tenantId:string;id:string}>('contentos-publishing',delivery=>publishingProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:2});
publishingWorker.on('error',error=>operationalError('publishing_worker_error','QUEUE_UNAVAILABLE',error));
const youtubeUploads=new YouTubeUploadRepository(database.db),youtubeProvider=youtubePublishingFromEnvironment(env),youtubeVault=credentialVaultFromEnvironment(env);
const youtubeAccess=new YouTubeService(new YouTubeOAuthRepository(database.db),new SocialRepository(database.db),youtubeProvider,youtubeVault);
const youtubeProcessor=new YouTubePublishingProcessor(youtubeUploads,publishingRepository,youtubeAccess,youtubeProvider,youtubeVault,storage,errors);
const youtubeQueue=new Queue('contentos-youtube-publishing',{connection});
const youtubeWorker=new Worker<{tenantId:string;id:string}>('contentos-youtube-publishing',delivery=>youtubeProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:2});
const youtubeResolutionRepository=new YouTubeResolutionRepository(database.db);
const youtubeResolver=new YouTubeResolutionService(youtubeResolutionRepository,youtubeAccess,youtubeProvider,env.PLATFORM_ADMIN_ENABLED==='true');
const youtubeResolutionProcessor=new YouTubeResolutionProcessor(youtubeResolutionRepository,youtubeResolver,errors);
const youtubeResolutionQueue=new Queue('contentos-youtube-resolution',{connection});
const youtubeResolutionWorker=new Worker<{tenantId:string;id:string}>('contentos-youtube-resolution',delivery=>youtubeResolutionProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:2});
youtubeResolutionWorker.on('error',error=>operationalError('youtube_resolution_worker_error','QUEUE_UNAVAILABLE',error));
const publicationAnalyticsRepository=new PublicationAnalyticsRepository(database.db);
const publicationAnalyticsProvider=youtubeProvider;
const publicationAnalyticsAccess=new YouTubeService(new YouTubeOAuthRepository(database.db),new SocialRepository(database.db),publicationAnalyticsProvider,youtubeVault);
const publicationAnalyticsProcessor=new PublicationAnalyticsProcessor(publicationAnalyticsRepository,publicationAnalyticsAccess,publicationAnalyticsProvider,errors,env.YOUTUBE_TEST_MODE==='true'?'DEMO':'API');
const publicationAnalyticsQueue=new Queue('contentos-publication-analytics',{connection});
const publicationAnalyticsWorker=new Worker<{tenantId:string;id:string}>('contentos-publication-analytics',delivery=>publicationAnalyticsProcessor.run(delivery.data.tenantId,delivery.data.id),{connection,concurrency:2});
publicationAnalyticsWorker.on('error',error=>operationalError('publication_analytics_worker_error','QUEUE_UNAVAILABLE',error));
youtubeWorker.on('error',error=>operationalError('youtube_worker_error','QUEUE_UNAVAILABLE',error));
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
    const cached = (await calls.cached()).map(row=>workflowType==='REVIEW_SCRIPT'?validateBrandReview(row.output,input):workflowType==='OPTIMIZE_STRATEGY'?validatePerformanceOutput(row.output,input.performance!.evidence):workflowSchemas[workflowType].safeParse(row.output)).find(result=>result.success);
    const output = cached?.success ? cached.data : await orchestrator.run(workflowType,input,{internalId:job.id,tenantId:job.tenantId,idempotencyKey:job.idempotencyKey,correlationId:job.correlationId,signal:abort.signal},calls);
    await repository.complete(job.tenantId,job.id,leaseToken,output);
    console.log(JSON.stringify({event:'job_completed',jobId:job.id,correlationId:job.correlationId,provider:job.provider,attempt:job.attempt}));
  } catch (error) {
    const code = error instanceof DomainError ? error.code : 'PROVIDER_UNAVAILABLE';
    reportError(errors,error,{correlationId:job.correlationId,jobId:job.id,code});
    try { await repository.fail(job.tenantId,job.id,leaseToken,code,code === 'PROVIDER_UNAVAILABLE'); }
    catch (failure) { if (!(failure instanceof DomainError && failure.code === 'CONFLICT')) throw failure; }
    console.log(JSON.stringify({event:'job_error',jobId:job.id,correlationId:job.correlationId,code}));
  } finally { clearInterval(heartbeat); }
},{connection,concurrency:3});
worker.on('error',error=>operationalError('worker_error','QUEUE_UNAVAILABLE',error));
connection.on('error',error=>operationalError('redis_error','QUEUE_UNAVAILABLE',error));
for(const backgroundWorker of [worker,youtubeResolutionWorker,publicationAnalyticsWorker,youtubeWorker,libraryMediaWorker,imageWorker,coverWorker,publishingWorker,analyticsWorker,paymentWorker]){
  backgroundWorker.on('failed',(delivery,error)=>{const id=delivery?.data?.id;reportError(errors,error,{correlationId:randomUUID(),...(typeof id==='string'?{jobId:id}:{})});});
}
let dispatching = false;
async function dispatch() {
  if (dispatching) return;
  dispatching = true;
  try {
    if(env.PAYMENT_RENEWALS_ENABLED==='true'&&renewalMerchant&&renewalFiscal&&renewalVaultReady){
      for(const candidate of await renewalRepository.due(renewalMerchant))await renewalRepository.schedule(candidate.tenantId,renewalMerchant,renewalFiscal);
    }
    if (paymentProvider) for(const event of await paymentWebhookRepository.due()){
      await paymentQueue.add('webhook',{id:event.id},{jobId:`webhook-${event.id}`,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await paymentWebhookRepository.dispatched(event.id);
    }
    if (paymentProvider) for (const task of await paymentRepository.dispatchable()) {
      await paymentQueue.add('payment', task, { jobId: task.id, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: true, removeOnFail: true });
      await paymentRepository.dispatched(task.tenantId, task.id);
    }
    for(const job of await channelAnalyticsRepository.due()){
      await analyticsQueue.add('fetch',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await channelAnalyticsRepository.dispatched(job.tenantId,job.id);
    }
    for(const job of await youtubeResolutionRepository.dueTasks()){
      await youtubeResolutionQueue.add('resolve',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await youtubeResolutionRepository.taskDispatched(job.tenantId,job.id);
    }
    for(const job of await publicationAnalyticsRepository.due()){
      await publicationAnalyticsQueue.add('fetch',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await publicationAnalyticsRepository.dispatched(job.tenantId,job.id);
    }
    for(const job of await youtubeUploads.due()){
      await youtubeQueue.add('publish',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await youtubeUploads.dispatched(job.tenantId,job.id);
    }
    for(const job of await publishingRepository.due()){
      await publishingQueue.add('publish',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await publishingRepository.dispatched(job.tenantId,job.id);
    }
    for(const job of await libraryMediaRepository.due('s3')){
      await libraryMediaQueue.add('PREPARE_MEDIA',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await libraryMediaRepository.dispatched(job.tenantId,job.id);
    }
    for(const job of await imageRepository.due()){
      await imageQueue.add('GENERATE_IMAGE',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await imageRepository.dispatched(job.tenantId,job.id);
    }
    for(const job of await coverRepository.due()){
      await coverQueue.add('GENERATE_COVER',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await coverRepository.dispatched(job.tenantId,job.id);
    }
    for (const job of await repository.due()) {
      await queue.add('generate',job,{jobId:job.id,attempts:3,backoff:{type:'exponential',delay:5000},removeOnComplete:true,removeOnFail:true});
      await repository.dispatched(job.tenantId,job.id);
    }
  } catch(error) { operationalError('dispatch_error','QUEUE_UNAVAILABLE',error); }
  finally { dispatching = false; }
}
const health = process.env.WORKER_HEALTH_PORT ? createServer((request,response)=> {
  if (request.url !== '/health') {response.writeHead(404);response.end();return;}
  const ready = connection.status === 'ready' && worker.isRunning() && youtubeResolutionWorker.isRunning() && publicationAnalyticsWorker.isRunning() && youtubeWorker.isRunning() && publishingWorker.isRunning() && analyticsWorker.isRunning() && paymentWorker.isRunning() && coverWorker.isRunning() && imageWorker.isRunning() && libraryMediaWorker.isRunning();
  response.writeHead(ready?200:503, {'Content-Type':'application/json'});response.end(JSON.stringify({status:ready?'ok':'unavailable'}));
}) : null;
if (health) health.listen(Number(process.env.WORKER_HEALTH_PORT),'127.0.0.1');
const timer = setInterval(()=>void dispatch(),2000);
let cleaning = false;
let cleanupTask: Promise<void> = Promise.resolve();
const cleanupTimer = setInterval(() => {
  if (cleaning) return;
  cleaning = true;
  cleanupTask = media.cleanupOne().then(()=>{}).catch(error=>operationalError('media_cleanup_error','PROVIDER_UNAVAILABLE',error)).then(()=>avatars.cleanupOne()).then(()=>{}).catch(error=>operationalError('avatar_cleanup_error','PROVIDER_UNAVAILABLE',error)).then(()=>videos.cleanupOne()).then(()=>{}).catch(error=>operationalError('video_cleanup_error','PROVIDER_UNAVAILABLE',error)).then(()=>imageProcessor.cleanupOne()).then(()=>{}).catch(error=>operationalError('image_cleanup_error','PROVIDER_UNAVAILABLE',error)).then(()=>libraryMediaProcessor.cleanupOne()).then(()=>{}).catch(error=>operationalError('library_media_cleanup_error','PROVIDER_UNAVAILABLE',error)).finally(()=>{cleaning=false;});
},2000);
void dispatch();
let projecting=false;
let notificationTask:Promise<unknown>=Promise.resolve();
const notificationTimer=setInterval(()=>{
  if(projecting)return;projecting=true;
  notificationTask=notificationRepository.projectBatch().catch(error=>operationalError('notification_projection_error','INTERNAL_ERROR',error)).finally(()=>{projecting=false;});
},5000);
let mailing=false;
let emailTask:Promise<unknown>=Promise.resolve();
const emailTimer=setInterval(()=>{if(mailing)return;mailing=true;emailTask=emailRepository.cleanup().then(()=>emailProcessor.runOnce()).then(()=>notificationEmailRepository.cleanup()).then(()=>notificationEmailRepository.projectBatch()).then(()=>notificationEmailProcessor.runOnce()).catch(error=>operationalError('email_worker_error','INTERNAL_ERROR',error)).finally(()=>{mailing=false;});},2000);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  clearInterval(timer); clearInterval(cleanupTimer); clearInterval(notificationTimer); clearInterval(emailTimer); await notificationTask; await emailTask; health?.close(); await worker.close(); await youtubeResolutionWorker.close(); await publicationAnalyticsWorker.close(); await youtubeWorker.close(); await publishingWorker.close(); await analyticsWorker.close(); await paymentWorker.close(); await coverWorker.close(); await imageWorker.close(); await libraryMediaWorker.close(); await cleanupTask; await queue.close(); await youtubeResolutionQueue.close(); await publicationAnalyticsQueue.close(); await youtubeQueue.close(); await publishingQueue.close(); await analyticsQueue.close(); await paymentQueue.close(); await coverQueue.close(); await imageQueue.close(); await libraryMediaQueue.close(); await connection.quit(); storage?.close(); await database.close(); await errors.flush?.(2000);
}
process.on('SIGTERM',()=>void stop()); process.on('SIGINT',()=>void stop());
console.log(JSON.stringify({event:'worker_started',provider:env.AI_PROVIDER}));
