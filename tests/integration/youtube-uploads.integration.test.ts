import {randomUUID} from 'node:crypto';
import {beforeAll,describe,expect,it} from 'vitest';
import {YouTubeResolutionRepository,AdminRepository,PublicationAnalyticsRepository,AnalyticsRepository,CalendarRepository,PublishingRepository,YouTubeUploadRepository} from '../../packages/db/src/index';
import * as s from '../../packages/db/src/schema';
import {seedDevelopment,demoIds} from '../../packages/db/src/development-seed';
import {YouTubeResolutionService,YouTubeResolutionProcessor} from '../../packages/core/src/youtube-resolutions';
import {PublicationAnalyticsProcessor} from '../../packages/core/src/publication-analytics';
import {YouTubePublishingProcessor} from '../../packages/core/src/youtube-publishing';
import {CredentialVault} from '../../packages/core/src/credential-vault';
import {normalizedMetricsSchema,youtubeMetricsObservationSchema,calendarCreateSchema,publishingApprovalSchema,videoProcessingSchema,DomainError,ProviderRequestError,type RangeStorageProvider,type YouTubePublishingProvider,type YouTubeVideo} from '../../packages/types/src/index';
import {isolatedTestDatabase} from '../helpers/isolated-database';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('durable YouTube upload checkpoints',()=>{
  const database=isolatedTestDatabase(url),repo=new YouTubeUploadRepository(database.db),publishing=new PublishingRepository(database.db),calendar=new CalendarRepository(database.db);
  const {user,tenant,brand,script,job:seedJob}=demoIds,scope={tenantId:tenant,brandId:brand},correlation=randomUUID();
  const subject=randomUUID(),avatar=randomUUID(),look=randomUUID(),voice=randomUUID(),photo=randomUUID(),videoId=randomUUID(),connection=randomUUID(),consentId=randomUUID();
  const channel='UC'+'a'.repeat(22),policies=[{type:'OWN_LIKENESS' as const,version:'fixture-v1',textHash:'a'.repeat(64)}];
  const vault=new CredentialVault(JSON.stringify({test:Buffer.alloc(32,7).toString('base64')}),'test');
  const reference=(id:string)=>({provider:'fixture',internalId:id,externalId:id,metadata:{}});
  const remote=(id:string,state:YouTubeVideo['state']='READY'):YouTubeVideo=>({reference:{provider:'youtube',internalId:id,externalId:'abcdefghijk',metadata:{}},channelId:channel,privacy:'UNLISTED',state,failureCode:null});
  const session=(id:string)=>vault.encrypt('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=synthetic',{tenantId:tenant,brandId:brand,connectionId:id,provider:'youtube-upload'});
  const due=async(id:string)=>{await database.client`update publishing_jobs set next_attempt_at=now()-interval '1 second',dispatch_after=now()-interval '1 second' where id=${id}`;};
  const expire=async(id:string)=>{await database.client`update publishing_jobs set lease_expires_at=now()-interval '1 second' where id=${id}`;};
  const state=async(id:string)=>(await database.client`select status from publishing_jobs where id=${id}`)[0]!.status;
  async function approved(cover=false){
    const entry=await calendar.create(user,tenant,brand,calendarCreateSchema.parse({title:'Approved YouTube video',type:'SHORT_VIDEO',platform:'YOUTUBE',caption:'Reviewed description',hashtags:['fixture'],privacy:'UNLISTED',commentsEnabled:true,videoProjectId:videoId,localDateTime:new Date(Date.now()+3600000).toISOString().slice(0,16),timeZone:'UTC',idempotencyKey:randomUUID()}),policies,correlation);
    const input=publishingApprovalSchema.parse({calendarId:entry.id,revision:0,connectionId:connection,idempotencyKey:randomUUID(),youtube:{categoryId:'22',madeForKids:false,containsSyntheticMedia:true,uploadCover:cover}});
    const created=await publishing.approve(user,tenant,brand,input,'youtube',policies,correlation);await due(created.id);return {created,input};
  }
  async function begun(cover=false){const {created}=await approved(cover);const claimed=(await repo.claim(tenant,created.id))!;await repo.begin(claimed.job,'"fixture-v1"',policies);return claimed.job;}
  beforeAll(async()=>{
    await seedDevelopment(database.db,`scrypt:v1:${'0'.repeat(32)}:${'0'.repeat(128)}`);
    await database.client`update scripts set approved_version=1,approved_by=${user} where id=${script}`;
    await database.db.insert(s.consentSubjects).values({id:subject,...scope,name:'Synthetic subject',type:'PERSON'});
    await database.db.insert(s.consentRecords).values({id:consentId,tenantId:tenant,subjectId:subject,subjectType:'PERSON',subjectName:'Synthetic subject',consentType:'OWN_LIKENESS',consentVersion:policies[0]!.version,consentTextHash:policies[0]!.textHash,acceptedByUserId:user,ipAddress:'127.0.0.1',userAgent:'fixture',idempotencyKey:randomUUID()});
    await database.db.insert(s.mediaAssets).values({id:photo,...scope,uploadedBy:user,name:'Synthetic photo',provider:'fixture',storageKey:`${tenant}/fixture.jpg`,mimeType:'image/jpeg',bytes:10,width:1,height:1,sha256:'a'.repeat(64),inputHash:'a'.repeat(64),idempotencyKey:randomUUID(),correlationId:correlation});
    await database.db.insert(s.voiceProfiles).values({id:voice,...scope,provider:'fixture',externalId:voice,reference:reference(voice),name:'Synthetic voice'});
    await database.db.insert(s.avatars).values({id:avatar,...scope,subjectId:subject,voiceId:voice,name:'Synthetic avatar',provider:'fixture',correlationId:correlation});
    await database.db.insert(s.avatarLooks).values({id:look,tenantId:tenant,avatarId:avatar,sourceAssetId:photo,jobId:seedJob,name:'Synthetic look',status:'READY',reference:reference(look)});
    await database.db.insert(s.videoProjects).values({id:videoId,...scope,jobId:seedJob,scriptId:script,scriptVersion:1,lookId:look,voiceId:voice,scriptText:'Synthetic fixture',title:'Synthetic video',platform:'YOUTUBE',plannedDuration:10,avatarReference:reference(look),voiceReference:reference(voice),consent:{subjectId:subject,requirements:policies.map(policy=>({...policy,recordId:consentId}))},options:videoProcessingSchema.parse({}),maxDurationSeconds:30,stage:'READY',provider:'fixture',originalKey:`${tenant}/original.mp4`,finalKey:`${tenant}/final.mp4`,coverKey:`${tenant}/cover.jpg`,durationMs:10000,finalBytes:1024,approvedAt:new Date(),approvedBy:user});
    await database.db.insert(s.socialConnections).values({id:connection,...scope,provider:'youtube',reference:{provider:'youtube',internalId:connection,externalId:channel,metadata:{}},name:'Synthetic channel',status:'ACTIVE',credential:vault.encrypt('synthetic token',{...scope,connectionId:connection,provider:'youtube'}),idempotencyKey:randomUUID(),inputHash:'fixture',createdBy:user});
  });
  it('freezes provider metadata and keeps YouTube jobs out of the Telegram dispatcher',async()=>{
    const {created,input}=await approved();expect(await publishing.approve(user,tenant,brand,input,'youtube',policies,correlation)).toEqual(created);
    expect((await publishing.due()).some(row=>row.id===created.id)).toBe(false);expect(await publishing.claim(tenant,created.id)).toBeNull();expect((await repo.due()).some(row=>row.id===created.id)).toBe(true);
    const results=await Promise.all([repo.claim(tenant,created.id),repo.claim(tenant,created.id)]);expect(results.filter(Boolean)).toHaveLength(1);
    const claimed=results.find(Boolean)!;expect(claimed.job.snapshot.youtube).toMatchObject({metadata:{privacy:'UNLISTED',title:'Approved YouTube video',madeForKids:false,containsSyntheticMedia:true},totalBytes:1024,coverKey:null});
    await expect(database.client`update publishing_jobs set snapshot='{}'::jsonb where id=${created.id}`).rejects.toThrow('immutable');
    await expect(repo.prepare({...claimed.job,tenantId:randomUUID()},policies)).rejects.toThrow();
    await expect(database.client`insert into youtube_uploads(tenant_id,job_id,source_etag,total_bytes,channel_id) values(${randomUUID()},${created.id},${'"fixture-v1"'},1024,${channel})`).rejects.toThrow('foreign key');
  });
  it('reconciles a lost initiation and preserves its late session without requeueing',async()=>{
    const job=await begun();await expire(job.id);expect(await repo.claim(tenant,job.id)).toBeNull();expect(await state(job.id)).toBe('RECONCILIATION');
    await repo.saveSession(job,session(job.id));expect(await state(job.id)).toBe('RECONCILIATION');expect(await repo.claim(tenant,job.id)).toBeNull();
    const [checkpoint]=await database.client`select * from youtube_uploads where job_id=${job.id}`;expect(checkpoint!.phase).toBe('UPLOADING');expect(JSON.stringify(checkpoint)).not.toContain('upload_id=synthetic');
  });
  it('persists monotonic progress, fences the old lease and does not spend retries on progress',async()=>{
    const job=await begun();await repo.saveSession(job,session(job.id));await repo.acknowledge(job,{state:'UPLOADING',nextByte:257,retryAfterSeconds:null});
    await expect(repo.acknowledge(job,{state:'UPLOADING',nextByte:256,retryAfterSeconds:null})).rejects.toThrow('PROVIDER_REJECTED');
    await expect(database.client`update youtube_uploads set next_byte=0 where job_id=${job.id}`).rejects.toThrow('immutable');
    await expect(database.client`update youtube_uploads set source_etag='"changed"' where job_id=${job.id}`).rejects.toThrow('immutable');
    await repo.reschedule(job);await due(job.id);const resumed=(await repo.claim(tenant,job.id))!;
    expect(resumed.upload).toMatchObject({nextByte:257,retryCount:0,sourceEtag:'"fixture-v1"'});expect(resumed.job.attempt).toBe(1);
    await expect(repo.acknowledge(job,{state:'UPLOADING',nextByte:512,retryAfterSeconds:null})).rejects.toThrow('CONFLICT');
    await repo.acknowledge(resumed.job,{state:'COMPLETE',video:remote(job.id,'PROCESSING')});
    await expect(repo.complete(resumed.job,remote(job.id))).rejects.toThrow('CONFLICT');
    await repo.processed(resumed.job,remote(job.id),policies);await repo.complete(resumed.job,remote(job.id));expect(await state(job.id)).toBe('PUBLISHED');
    expect(await database.client`select id from publications where job_id=${job.id}`).toHaveLength(1);expect((await database.client`select session,phase from youtube_uploads where job_id=${job.id}`)[0]).toMatchObject({session:null,phase:'COMPLETE'});
  });
  it('stores immutable API observations once and rechecks role, grant and remote ownership',async()=>{
    const analytics=new AnalyticsRepository(database.db),[publication]=await database.client`select p.id from publications p join publishing_jobs j on j.id=p.job_id where p.tenant_id=${tenant} and j.brand_id=${brand} order by p.recorded_at limit 1`;
    const observation=youtubeMetricsObservationSchema.parse({publicationId:publication!.id,idempotencyKey:randomUUID(),credentialVersion:1,videoId:'abcdefghijk',channelId:channel,observedAt:new Date().toISOString(),metrics:{views:0,likes:2}});
    const saved=await Promise.all([analytics.recordYouTube(user,tenant,brand,observation,correlation),analytics.recordYouTube(user,tenant,brand,observation,correlation)]);expect(saved[0]).toEqual(saved[1]);
    const history=await analytics.history(user,tenant,brand,observation.publicationId);expect(history).toHaveLength(1);expect(history[0]).toMatchObject({source:'API',metrics:{views:0,likes:2,comments:null,watch_time:null}});
    await expect(analytics.recordYouTube(user,tenant,brand,{...observation,metrics:{...observation.metrics,views:10}},correlation)).rejects.toThrow('CONFLICT');
    await expect(analytics.recordYouTube(user,tenant,randomUUID(),observation,correlation)).rejects.toThrow('NOT_FOUND');
    await expect(analytics.recordYouTube(user,tenant,brand,{...observation,channelId:'UC'+'z'.repeat(22)},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(analytics.recordYouTube(user,tenant,brand,{...observation,videoId:'z'.repeat(11)},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(analytics.recordYouTube(user,tenant,brand,{...observation,credentialVersion:2},correlation)).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');
    await expect(analytics.recordYouTube(user,tenant,brand,{...observation,idempotencyKey:randomUUID(),observedAt:'2099-01-01T00:00:00Z'},correlation)).rejects.toThrow('INVALID_INPUT');
    const editor=randomUUID();await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${editor},${editor+'@example.test'},'unusable','Editor',now())`;await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${editor},'EDITOR')`;
    await expect(analytics.recordYouTube(editor,tenant,brand,observation,correlation)).rejects.toThrow('NOT_AUTHORIZED');
    const [grant]=await database.client`select credential from social_connections where id=${connection}`;
    await database.client`update social_connections set status='REVOKED',credential=null where id=${connection}`;
    try{await expect(analytics.recordYouTube(user,tenant,brand,observation,correlation)).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');}
    finally{await database.client`update social_connections set status='ACTIVE',credential=${JSON.stringify(grant!.credential)}::jsonb where id=${connection}`;}
    await expect(database.client`update publication_metrics set metrics='{}'::jsonb where id=${saved[0]!.id}`).rejects.toThrow();await expect(database.client`delete from publication_metrics where id=${saved[0]!.id}`).rejects.toThrow();
  });
  it('queues one statistics request, fences delivery and commits its result exactly once',async()=>{
    const tasks=new PublicationAnalyticsRepository(database.db),[publication]=await database.client`select id from publications where tenant_id=${tenant} order by recorded_at limit 1`,id=String(publication!.id),key=randomUUID();
    await expect(tasks.request(user,tenant,brand,id,key,correlation,'DEMO')).rejects.toThrow('CONFIGURATION_REQUIRED');
    const requests=await Promise.all([tasks.request(user,tenant,brand,id,key,correlation),tasks.request(user,tenant,brand,id,key,correlation)]);expect(requests[0]).toEqual(requests[1]);
    await expect(tasks.request(user,tenant,brand,id,randomUUID(),correlation)).rejects.toThrow('CONFLICT');
    await expect(tasks.request(user,tenant,randomUUID(),id,key,correlation)).rejects.toThrow('NOT_FOUND');
    expect((await tasks.due()).some(row=>row.id===requests[0]!.id)).toBe(true);
    await tasks.dispatched(tenant,requests[0]!.id);expect((await tasks.due()).some(row=>row.id===requests[0]!.id)).toBe(false);
    const claims=await Promise.all([tasks.claim(tenant,requests[0]!.id),tasks.claim(tenant,requests[0]!.id)]);expect(claims.filter(Boolean)).toHaveLength(1);const job=claims.find(Boolean)!;
    const observation=youtubeMetricsObservationSchema.parse({publicationId:id,idempotencyKey:job.id,credentialVersion:1,videoId:'abcdefghijk',channelId:channel,observedAt:new Date().toISOString(),metrics:{views:17}});
    await expect(tasks.complete(job,{...observation,videoId:'xxxxxxxxxxx'})).rejects.toThrow('PROVIDER_REJECTED');
    expect(await database.client`select id from publication_metrics where idempotency_key=${job.id}`).toHaveLength(0);
    await database.client`update publication_analytics_jobs set lease_expires_at=now()-interval '1 second' where id=${job.id}`;
    const next=(await tasks.claim(tenant,job.id))!;await expect(tasks.complete(job,observation)).rejects.toThrow('CONFLICT');
    await tasks.fail(job,'PROVIDER_UNAVAILABLE');expect((await tasks.overview(user,tenant,brand))[0]!.status).toBe('RUNNING');
    await tasks.complete(next,{...observation,observedAt:new Date().toISOString()});
    expect((await tasks.overview(user,tenant,brand))[0]).toMatchObject({status:'SUCCEEDED',attempt:2});
    expect(await database.client`select id from publication_metrics where idempotency_key=${job.id}`).toHaveLength(1);
    expect(await tasks.claim(tenant,job.id)).toBeNull();await expect(tasks.complete(next,observation)).rejects.toThrow('CONFLICT');
    await expect(tasks.request(user,tenant,brand,id,randomUUID(),correlation)).rejects.toThrow('RATE_LIMITED');
  });
  it('bounds statistics retries and rejects revoked grants without saving observations',async()=>{
    const tasks=new PublicationAnalyticsRepository(database.db),[publication]=await database.client`select id from publications where tenant_id=${tenant} order by recorded_at limit 1`,id=String(publication!.id);
    await database.client`update publication_analytics_jobs set created_at=now()-interval '2 minutes' where publication_id=${id}`;
    const request=await tasks.request(user,tenant,brand,id,randomUUID(),correlation);
    let calls=0;
    const access={accessForPublication:async()=>({accessToken:'synthetic',channelId:channel})};
    const processor=new PublicationAnalyticsProcessor(tasks,access,{statistics:async()=>{calls++;throw new DomainError('PROVIDER_UNAVAILABLE');}});
    for(let attempt=1;attempt<=3;attempt++){
      await processor.run(tenant,request.id);
      const [job]=await database.client`select status,attempt from publication_analytics_jobs where id=${request.id}`;
      expect(job).toMatchObject({status:attempt===3?'FAILED':'QUEUED',attempt});
      if(attempt<3){expect(await tasks.claim(tenant,request.id)).toBeNull();await database.client`update publication_analytics_jobs set next_attempt_at=now()-interval '1 second' where id=${request.id}`;}
    }
    await processor.run(tenant,request.id);expect(calls).toBe(3);
    await database.client`update publication_analytics_jobs set created_at=now()-interval '2 minutes' where publication_id=${id}`;
    const revoked=await tasks.request(user,tenant,brand,id,randomUUID(),correlation),job=(await tasks.claim(tenant,revoked.id))!;
    await database.client`update social_connections set credential_version=credential_version+1 where id=${connection}`;
    try{
      await expect(tasks.prepare(job)).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');
      await expect(tasks.complete(job,youtubeMetricsObservationSchema.parse({publicationId:id,idempotencyKey:job.id,credentialVersion:job.credentialVersion,videoId:'abcdefghijk',channelId:channel,observedAt:new Date().toISOString(),metrics:{views:0}}))).rejects.toThrow('SOCIAL_TOKEN_EXPIRED');
      await tasks.fail(job,'SOCIAL_TOKEN_EXPIRED');expect((await database.client`select status from publication_analytics_jobs where id=${job.id}`)[0]!.status).toBe('CANCELLED');
      expect(await database.client`select id from publication_metrics where idempotency_key=${job.id}`).toHaveLength(0);
    }finally{await database.client`update social_connections set credential_version=credential_version-1 where id=${connection}`;}
  });
  it('runs statistics through the processor and cancels missing videos without zero substitution',async()=>{
    const tasks=new PublicationAnalyticsRepository(database.db),[publication]=await database.client`select id from publications where tenant_id=${tenant} order by recorded_at limit 1`,id=String(publication!.id);
    const access={accessForPublication:async()=>({accessToken:'synthetic',channelId:channel})};
    for(const exists of [true,false]){
      await database.client`update publication_analytics_jobs set created_at=now()-interval '2 minutes' where publication_id=${id}`;
      const requested=await tasks.request(user,tenant,brand,id,randomUUID(),correlation);
      const processor=new PublicationAnalyticsProcessor(tasks,access,{statistics:async(_token,video,owner,context)=>{
        expect(video).toBe('abcdefghijk');expect(owner).toBe(channel);
        return exists?{reference:{provider:'youtube',internalId:context.internalId,externalId:video,metadata:{}},observedAt:new Date().toISOString(),metrics:normalizedMetricsSchema.parse({views:0,likes:3})}:null;
      }});
      await processor.run(tenant,requested.id);await processor.run(tenant,requested.id);
      expect((await database.client`select status from publication_analytics_jobs where id=${requested.id}`)[0]!.status).toBe(exists?'SUCCEEDED':'CANCELLED');
      expect(await database.client`select id from publication_metrics where idempotency_key=${requested.id}`).toHaveLength(exists?1:0);
    }
  });
  it('rechecks a role removed during the remote statistics read',async()=>{
    const tasks=new PublicationAnalyticsRepository(database.db),[publication]=await database.client`select id from publications where tenant_id=${tenant} order by recorded_at limit 1`,id=String(publication!.id);
    await database.client`update publication_analytics_jobs set created_at=now()-interval '2 minutes' where publication_id=${id}`;
    const requested=await tasks.request(user,tenant,brand,id,randomUUID(),correlation);
    const processor=new PublicationAnalyticsProcessor(tasks,{accessForPublication:async()=>({accessToken:'synthetic',channelId:channel})},{statistics:async(_token,video,_channel,context)=>{
      await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${user}`;
      return {reference:{provider:'youtube',internalId:context.internalId,externalId:video,metadata:{}},observedAt:new Date().toISOString(),metrics:normalizedMetricsSchema.parse({views:0})};
    }});
    try{
      await processor.run(tenant,requested.id);
      expect((await database.client`select status,error_code from publication_analytics_jobs where id=${requested.id}`)[0]).toMatchObject({status:'CANCELLED',error_code:'NOT_AUTHORIZED'});
      expect(await database.client`select id from publication_metrics where idempotency_key=${requested.id}`).toHaveLength(0);
      await expect(tasks.request(user,tenant,brand,id,randomUUID(),correlation)).rejects.toThrow('NOT_AUTHORIZED');
    }finally{await database.client`update organization_members set role='OWNER' where tenant_id=${tenant} and user_id=${user}`;}
  });
  it('exposes audited operator diagnostics without upload sessions, tokens or content',async()=>{
    const admin=new AdminRepository(database.db),operator=randomUUID();
    await expect(admin.list(user,{category:'publishing',limit:25},correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${operator},${operator+'@example.test'},'unusable','Support operator',now())`;
    await database.client`insert into platform_operators(user_id,role) values(${operator},'SUPPORT')`;
    const first=await admin.list(operator,{category:'publishing',limit:1,tenantId:tenant},correlation);expect(first.rows).toHaveLength(1);expect(first.next).not.toBeNull();
    const next=await admin.list(operator,{category:'publishing',limit:1,tenantId:tenant,...first.next!},correlation);expect(next.rows[0]!.id).not.toBe(first.rows[0]!.id);
    const reconciliation=await admin.list(operator,{category:'publishing_reconciliation',limit:25,tenantId:tenant},correlation);
    expect(reconciliation.rows.length).toBeGreaterThan(0);expect(reconciliation.rows.every(row=>row.status==='RECONCILIATION')).toBe(true);
    expect(reconciliation.rows.some(row=>row.hasUploadSession===true)).toBe(true);
    const metrics=await admin.list(operator,{category:'publication_analytics',limit:25,tenantId:tenant},correlation);expect(metrics.rows.length).toBeGreaterThan(0);expect(metrics.rows.some(row=>row.source==='API')).toBe(true);
    for(const category of ['publishing','publishing_reconciliation','publication_analytics'] as const){
      expect((await admin.list(operator,{category,limit:25,tenantId:randomUUID()},correlation)).rows).toEqual([]);
      const data=await admin.list(operator,{category,limit:25,tenantId:tenant},correlation);
      for(const row of data.rows)for(const forbidden of ['session','credential','snapshot','leaseToken','sourceEtag','inputHash'])expect(row).not.toHaveProperty(forbidden);
      expect(JSON.stringify(data)).not.toMatch(/ciphertext|upload_id=synthetic|synthetic token|Approved YouTube video/);
    }
    expect((await database.client`select id from audit_logs where user_id=${operator} and action='ADMIN_DATA_READ'`).length).toBeGreaterThan(0);
    await database.client`update platform_operators set revoked_at=now() where user_id=${operator}`;
    await expect(admin.list(operator,{category:'publishing_reconciliation',limit:25},correlation)).rejects.toThrow('NOT_AUTHORIZED');
  });
  it('resolves a known verified video atomically and idempotently without remote writes',async()=>{
    const resolutions=new YouTubeResolutionRepository(database.db),actor=randomUUID();
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${actor},${actor+'@example.test'},'unusable','Resolution admin',now())`;
    await database.client`insert into platform_operators(user_id,role) values(${actor},'ADMIN')`;
    for(const phase of ['PROCESSING','VERIFYING']){
      const job=await begun();await repo.saveSession(job,session(job.id));await repo.acknowledge(job,{state:'COMPLETE',video:remote(job.id)});
      if(phase==='VERIFYING')await repo.processed(job,remote(job.id),policies);
      await repo.reconcile(job);
      const [checkpoint]=await database.client`select revision from youtube_uploads where job_id=${job.id}`;
      const input={tenantId:tenant,jobId:job.id,expectedRevision:Number(checkpoint!.revision),ticket:'VERIFY-42',idempotencyKey:randomUUID()};
      let reads=0;
      const service=new YouTubeResolutionService(resolutions,{accessForPublication:async()=>({accessToken:'synthetic',channelId:channel})},{video:async(_token,id,owner,context)=>{reads++;expect(id).toBe('abcdefghijk');expect(owner).toBe(channel);return remote(context.internalId);}},true,()=>policies);
      await expect(service.resolve(user,input,correlation)).rejects.toThrow('NOT_AUTHORIZED');expect(reads).toBe(0);
      const resolved=await Promise.all([service.resolve(actor,input,correlation),service.resolve(actor,input,correlation)]);expect(resolved[0]).toEqual(resolved[1]);
      const prior=reads;expect(await service.resolve(actor,input,correlation)).toEqual(resolved[0]);expect(reads).toBe(prior);
      expect(await state(job.id)).toBe('PUBLISHED');expect(await database.client`select id from publications where job_id=${job.id}`).toHaveLength(1);
      expect((await database.client`select phase,session from youtube_uploads where job_id=${job.id}`)[0]).toMatchObject({phase:'COMPLETE',session:null});
      expect(await database.client`select id from youtube_resolutions where job_id=${job.id}`).toHaveLength(1);
      await expect(service.resolve(actor,{...input,ticket:'CHANGED-42'},correlation)).rejects.toThrow('CONFLICT');
      await expect(database.client`update youtube_resolutions set ticket='MUTATED' where job_id=${job.id}`).rejects.toThrow('immutable');
      await expect(database.client`delete from youtube_resolutions where job_id=${job.id}`).rejects.toThrow('immutable');
      expect(await database.client`select id from audit_logs where resource_id=${job.id} and action='ADMIN_YOUTUBE_PUBLICATION_RESOLVED' and user_id=${actor}`).toHaveLength(1);
      await expect(repo.thumbnailSaved(job)).rejects.toThrow('CONFLICT');
    }
  });
  it('refuses uncertain thumbnails, stale checkpoints, changed privacy and authority during reconciliation',async()=>{
    const resolutions=new YouTubeResolutionRepository(database.db),actor=randomUUID();
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${actor},${actor+'@example.test'},'unusable','Resolution fixture',now())`;
    await database.client`insert into platform_operators(user_id,role) values(${actor},'SUPPORT')`;
    const job=await begun();await repo.saveSession(job,session(job.id));await repo.acknowledge(job,{state:'COMPLETE',video:remote(job.id)});await repo.reconcile(job);
    const [checkpoint]=await database.client`select revision from youtube_uploads where job_id=${job.id}`;
    const input={tenantId:tenant,jobId:job.id,expectedRevision:Number(checkpoint!.revision),ticket:'VERIFY-43',idempotencyKey:randomUUID()};
    await expect(resolutions.prepare(actor,input,policies,correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update platform_operators set role='ADMIN' where user_id=${actor}`;
    await expect(resolutions.prepare(actor,{...input,expectedRevision:input.expectedRevision-1},policies,correlation)).rejects.toThrow('RECONCILIATION_REQUIRED');
    await expect(resolutions.prepare(actor,{...input,tenantId:randomUUID()},policies,correlation)).rejects.toThrow('NOT_FOUND');
    for(const video of [{...remote(job.id),privacy:'PRIVATE' as const},remote(job.id,'PROCESSING'),{...remote(job.id),channelId:'UC'+'z'.repeat(22)},{...remote(job.id),reference:{...remote(job.id).reference,metadata:{demo:true}}}])await expect(resolutions.complete(actor,input,video,new Date(),policies,correlation)).rejects.toThrow('PROVIDER_REJECTED');
    await expect(resolutions.complete(actor,input,remote(job.id),new Date(Date.now()-120000),policies,correlation)).rejects.toThrow('PROVIDER_REJECTED');
    const service=new YouTubeResolutionService(resolutions,{accessForPublication:async()=>({accessToken:'synthetic',channelId:channel})},{video:async()=>{await database.client`update platform_operators set revoked_at=now() where user_id=${actor}`;return remote(job.id);}},true,()=>policies);
    await expect(service.resolve(actor,input,correlation)).rejects.toThrow('NOT_AUTHORIZED');expect(await state(job.id)).toBe('RECONCILIATION');expect(await database.client`select id from publications where job_id=${job.id}`).toHaveLength(0);
    await database.client`update platform_operators set revoked_at=null where user_id=${actor}`;
    const cover=await begun(true);await repo.saveSession(cover,session(cover.id));await repo.acknowledge(cover,{state:'COMPLETE',video:remote(cover.id)});await repo.processed(cover,remote(cover.id),policies);await repo.reconcile(cover);
    const [pendingCover]=await database.client`select revision from youtube_uploads where job_id=${cover.id}`;
    await expect(resolutions.prepare(actor,{...input,jobId:cover.id,expectedRevision:Number(pendingCover!.revision),idempotencyKey:randomUUID()},policies,correlation)).rejects.toThrow('RECONCILIATION_REQUIRED');
  });
  it('queues fenced resolutions with bounded retries and atomic completion',async()=>{
    const resolutions=new YouTubeResolutionRepository(database.db),actor=randomUUID();
    await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${actor},${actor+'@example.test'},'unusable','Queued resolution admin',now())`;await database.client`insert into platform_operators(user_id,role) values(${actor},'ADMIN')`;
    async function request(){
      const job=await begun();await repo.saveSession(job,session(job.id));await repo.acknowledge(job,{state:'COMPLETE',video:remote(job.id)});await repo.reconcile(job);
      const [checkpoint]=await database.client`select revision from youtube_uploads where job_id=${job.id}`;
      return {job,input:{tenantId:tenant,jobId:job.id,expectedRevision:Number(checkpoint!.revision),ticket:'QUEUE-42',idempotencyKey:randomUUID()}};
    }
    const first=await request(),intents=await Promise.all([resolutions.enqueue(actor,first.input,policies,correlation),resolutions.enqueue(actor,first.input,policies,correlation)]);expect(intents[0]).toEqual(intents[1]);
    await expect(resolutions.enqueue(actor,{...first.input,idempotencyKey:randomUUID()},policies,correlation)).rejects.toThrow('CONFLICT');
    await expect(database.client`update youtube_resolution_tasks set input='{}'::jsonb where id=${intents[0]!.id}`).rejects.toThrow('immutable');
    expect((await resolutions.dueTasks()).some(row=>row.id===intents[0]!.id)).toBe(true);
    const claimed=await Promise.all([resolutions.claimTask(tenant,intents[0]!.id),resolutions.claimTask(tenant,intents[0]!.id)]);expect(claimed.filter(Boolean)).toHaveLength(1);const stale=claimed.find(Boolean)!;
    await database.client`update youtube_resolution_tasks set lease_expires_at=now()-interval '1 second' where id=${stale.id}`;
    const fresh=(await resolutions.claimTask(tenant,stale.id))!;
    const service=new YouTubeResolutionService(resolutions,{accessForPublication:async()=>({accessToken:'synthetic',channelId:channel})},{video:async(_token,_video,_channel,context)=>remote(context.internalId)},true,()=>policies);
    await expect(service.resolve(actor,first.input,correlation,{id:stale.id,leaseToken:stale.leaseToken!})).rejects.toThrow('CONFLICT');
    const resolved=await service.resolve(actor,first.input,correlation,{id:fresh.id,leaseToken:fresh.leaseToken!});
    const tasks=await resolutions.tasks(actor,tenant,first.job.id,correlation);expect(tasks[0]).toMatchObject({status:'SUCCEEDED',resolutionId:resolved.id,attempt:2});
    await resolutions.taskDispatched(tenant,fresh.id);await resolutions.acknowledgeTask(fresh,resolved.id);expect(await resolutions.claimTask(tenant,fresh.id)).toBeNull();
    await expect(database.client`update youtube_resolution_tasks set status='QUEUED' where id=${fresh.id}`).rejects.toThrow('immutable');
    const second=await request(),retry=await resolutions.enqueue(actor,second.input,policies,correlation);let reads=0;
    const failing=new YouTubeResolutionProcessor(resolutions,new YouTubeResolutionService(resolutions,{accessForPublication:async()=>({accessToken:'synthetic',channelId:channel})},{video:async()=>{reads++;throw new DomainError('PROVIDER_UNAVAILABLE');}},true,()=>policies));
    for(let attempt=1;attempt<=3;attempt++){
      await failing.run(tenant,retry.id);expect((await resolutions.tasks(actor,tenant,second.job.id,correlation))[0]).toMatchObject({attempt,status:attempt===3?'FAILED':'QUEUED'});
      if(attempt<3){expect(await resolutions.claimTask(tenant,retry.id)).toBeNull();await database.client`update youtube_resolution_tasks set next_attempt_at=now()-interval '1 second' where id=${retry.id}`;}
    }
    expect(reads).toBe(3);expect(await state(second.job.id)).toBe('RECONCILIATION');
    const third=await request(),revoked=await resolutions.enqueue(actor,third.input,policies,correlation);await database.client`update platform_operators set revoked_at=now() where user_id=${actor}`;
    await failing.run(tenant,revoked.id);expect(reads).toBe(3);expect((await database.client`select status from youtube_resolution_tasks where id=${revoked.id}`)[0]!.status).toBe('CANCELLED');
    await expect(resolutions.tasks(actor,tenant,third.job.id,correlation)).rejects.toThrow('NOT_AUTHORIZED');
  });
  it('requires the approved channel, remote identity and visibility before completion',async()=>{
    const job=await begun();await repo.saveSession(job,session(job.id));
    await expect(repo.acknowledge(job,{state:'COMPLETE',video:{...remote(job.id),channelId:'UC'+'b'.repeat(22)}})).rejects.toThrow('PROVIDER_REJECTED');
    await repo.acknowledge(job,{state:'COMPLETE',video:remote(job.id)});await repo.processed(job,remote(job.id),policies);
    await expect(repo.complete(job,{...remote(job.id),privacy:'PUBLIC'})).rejects.toThrow('CONFLICT');expect(await state(job.id)).toBe('SUBMITTING');
    await repo.reconcile(job);expect(await state(job.id)).toBe('RECONCILIATION');
  });
  it('bounds transient retries and never restarts an expired upload session',async()=>{
    let job=await begun();await repo.saveSession(job,session(job.id));
    for(let i=1;i<=8;i++){await repo.reschedule(job,{error:'PROVIDER_UNAVAILABLE',retryAfterSeconds:60});if(i<8){expect(await repo.claim(tenant,job.id)).toBeNull();await due(job.id);job=(await repo.claim(tenant,job.id))!.job;}}
    expect(await state(job.id)).toBe('RECONCILIATION');expect(await repo.claim(tenant,job.id)).toBeNull();
    const expired=await begun();await repo.saveSession(expired,session(expired.id));await repo.acknowledge(expired,{state:'EXPIRED'});expect(await state(expired.id)).toBe('RECONCILIATION');
  });
  it('retains the remote video when thumbnail acknowledgement is lost',async()=>{
    const job=await begun(true);await repo.saveSession(job,session(job.id));await repo.acknowledge(job,{state:'COMPLETE',video:remote(job.id)});await repo.processed(job,remote(job.id),policies);
    await expire(job.id);expect(await repo.claim(tenant,job.id)).toBeNull();expect(await state(job.id)).toBe('RECONCILIATION');
    await repo.thumbnailSaved(job);expect(await state(job.id)).toBe('RECONCILIATION');expect((await database.client`select video_id,phase from youtube_uploads where job_id=${job.id}`)[0]).toMatchObject({video_id:'abcdefghijk',phase:'VERIFYING'});
  });
  it('requires new publication approval after a video is reapproved at the same key and size',async()=>{
    const job=await begun();await repo.saveSession(job,session(job.id));
    await database.client`update video_projects set approved_at=approved_at+interval '1 second' where id=${videoId}`;
    await expect(repo.prepare(job,policies)).rejects.toThrow('CONFLICT');
    await repo.reconcile(job,'CONFLICT');expect(await state(job.id)).toBe('RECONCILIATION');
  });
  it('also fences Telegram video approvals after source reapproval',async()=>{
    const telegram=randomUUID();await database.db.insert(s.socialConnections).values({id:telegram,...scope,provider:'telegram',reference:{provider:'telegram',internalId:telegram,externalId:'-1001234567890',metadata:{public:true,hasLinkedDiscussion:false}},name:'Synthetic Telegram',status:'ACTIVE',credential:vault.encrypt('synthetic',{...scope,connectionId:telegram,provider:'telegram'}),idempotencyKey:randomUUID(),inputHash:'fixture',createdBy:user});
    const entry=await calendar.create(user,tenant,brand,calendarCreateSchema.parse({title:'Telegram fixture',type:'SHORT_VIDEO',platform:'TELEGRAM',caption:'Reviewed',privacy:'PUBLIC',commentsEnabled:false,videoProjectId:videoId,localDateTime:new Date(Date.now()+3600000).toISOString().slice(0,16),timeZone:'UTC',idempotencyKey:randomUUID()}),policies,correlation);
    const created=await publishing.approve(user,tenant,brand,publishingApprovalSchema.parse({calendarId:entry.id,revision:0,connectionId:telegram,idempotencyKey:randomUUID()}),'telegram',policies,correlation);await due(created.id);const job=(await publishing.claim(tenant,created.id))!;
    expect(job.snapshot.videoRevision).toBe(0);expect(job.snapshot.videoApprovedAt).toBeTruthy();
    await database.client`update video_projects set approved_at=approved_at+interval '1 second' where id=${videoId}`;
    await expect(publishing.prepare(job,policies)).rejects.toThrow('CONFLICT');
  });
  function workerFixture(){
    let starts=0,probes=0,sends=0,thumbnails=0,accepted=false;
    const provider:YouTubePublishingProvider={
      startUpload:async()=>{starts++;return 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=synthetic';},
      probeUpload:async(_token,_session,_total,_channel,ctx)=>{probes++;return accepted?{state:'COMPLETE',video:remote(ctx.internalId,'PROCESSING')}:{state:'UPLOADING',nextByte:0,retryAfterSeconds:null};},
      upload:async(_token,_session,input,ctx)=>{sends++;expect(input.offset).toBe(0);expect(input.bytes.length).toBe(1024);accepted=true;return {state:'COMPLETE',video:remote(ctx.internalId,'PROCESSING')};},
      video:async(_token,_id,_channel,ctx)=>remote(ctx.internalId),thumbnail:async()=>{thumbnails++;},
    };
    const storage:RangeStorageProvider={inspectObject:async()=>({bytes:1024,etag:'"fixture-v1"',mimeType:'video/mp4'}),getRange:async()=>new Uint8Array(1024),get:async()=>new Uint8Array([255,216,255]),put:async()=>{},delete:async()=>{},signedDownload:async()=>{throw new Error('Unused');}};
    const access={accessForPublication:async()=>({accessToken:'synthetic',channelId:channel})};
    const processor=new YouTubePublishingProcessor(repo,publishing,access,provider,vault,storage,undefined,()=>policies);
    return {provider,storage,processor,counts:()=>({starts,probes,sends,thumbnails}),accept:()=>{accepted=true;}};
  }
  it('executes approval, persisted session, probe, upload, thumbnail and verification once across deliveries',async()=>{
    const fixture=workerFixture(),{created}=await approved(true);
    for(let i=0;i<5;i++){await due(created.id);await Promise.all([fixture.processor.run(tenant,created.id),fixture.processor.run(tenant,created.id)]);}
    expect(await state(created.id)).toBe('PUBLISHED');expect(fixture.counts()).toEqual({starts:1,probes:1,sends:1,thumbnails:1});
    await fixture.processor.run(tenant,created.id);expect(fixture.counts().sends).toBe(1);
  });
  it('probes after a lost chunk acknowledgement instead of sending the video again',async()=>{
    const fixture=workerFixture(),{created}=await approved();let sends=0;
    fixture.provider.upload=async()=>{sends++;fixture.accept();throw new ProviderRequestError('RECONCILIATION_REQUIRED',409,false);};
    for(let i=0;i<6;i++){await due(created.id);await fixture.processor.run(tenant,created.id);}
    expect(await state(created.id)).toBe('PUBLISHED');expect(sends).toBe(1);expect(fixture.counts().starts).toBe(1);expect(fixture.counts().probes).toBe(2);
  });
  it('retries verified initiation rejection but never retries an unknown initiation result',async()=>{
    const fixture=workerFixture(),{created}=await approved();let starts=0;const original=fixture.provider.startUpload;
    fixture.provider.startUpload=async(...args)=>{if(++starts===1)throw new ProviderRequestError('RATE_LIMITED',429,true);return original(...args);};
    await fixture.processor.run(tenant,created.id);expect(await state(created.id)).toBe('SCHEDULED');expect(await repo.claim(tenant,created.id)).toBeNull();
    for(let i=0;i<5;i++){await due(created.id);await fixture.processor.run(tenant,created.id);}
    expect(starts).toBe(2);expect(await state(created.id)).toBe('PUBLISHED');
    const unknown=workerFixture(),next=await approved();let uncertainCalls=0;
    unknown.provider.startUpload=async()=>{uncertainCalls++;throw new ProviderRequestError('RECONCILIATION_REQUIRED',409,false);};
    await unknown.processor.run(tenant,next.created.id);await due(next.created.id);await unknown.processor.run(tenant,next.created.id);
    expect(uncertainCalls).toBe(1);expect(await state(next.created.id)).toBe('RECONCILIATION');
  });
  it('rechecks permissions after a slow source read before sending a chunk',async()=>{
    const fixture=workerFixture(),{created}=await approved();await fixture.processor.run(tenant,created.id);
    fixture.storage.getRange=async()=>{await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${user}`;return new Uint8Array(1024);};
    await due(created.id);await fixture.processor.run(tenant,created.id);
    expect(fixture.counts().sends).toBe(0);expect(await state(created.id)).toBe('RECONCILIATION');
    await database.client`update organization_members set role='OWNER' where tenant_id=${tenant} and user_id=${user}`;
  });
  it('does not repeat an uncertain thumbnail mutation or claim mismatched privacy as published',async()=>{
    const fixture=workerFixture(),{created}=await approved(true);let thumbnails=0;
    fixture.provider.thumbnail=async()=>{thumbnails++;throw new ProviderRequestError('RECONCILIATION_REQUIRED',409,false);};
    for(let i=0;i<5;i++){await due(created.id);await fixture.processor.run(tenant,created.id);}
    expect(thumbnails).toBe(1);expect(await state(created.id)).toBe('RECONCILIATION');
    const mismatch=workerFixture(),next=await approved();mismatch.provider.video=async(_token,_id,_channel,ctx)=>({...remote(ctx.internalId),privacy:'PRIVATE'});
    for(let i=0;i<4;i++){await due(next.created.id);await mismatch.processor.run(tenant,next.created.id);}
    expect(await state(next.created.id)).toBe('RECONCILIATION');expect(await database.client`select id from publications where job_id=${next.created.id}`).toHaveLength(0);
  });
  it('fails closed when the publishing integration is not configured',async()=>{
    const {created}=await approved();const processor=new YouTubePublishingProcessor(repo,publishing,{accessForPublication:async()=>{throw new DomainError('CONFIGURATION_REQUIRED');}},null,null,null,undefined,()=>policies);
    await processor.run(tenant,created.id);expect(await state(created.id)).toBe('FAILED');expect((await database.client`select error_code from publishing_jobs where id=${created.id}`)[0]!.error_code).toBe('CONFIGURATION_REQUIRED');
  });
  it('rechecks consent and current membership before further remote work, preserving acknowledgements',async()=>{
    const resolutionJob=await begun();await repo.saveSession(resolutionJob,session(resolutionJob.id));await repo.acknowledge(resolutionJob,{state:'COMPLETE',video:remote(resolutionJob.id)});await repo.reconcile(resolutionJob);
    const [checkpoint]=await database.client`select revision from youtube_uploads where job_id=${resolutionJob.id}`;
    const actor=randomUUID();await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${actor},${actor+'@example.test'},'unusable','Consent recheck admin',now())`;await database.client`insert into platform_operators(user_id,role) values(${actor},'ADMIN')`;
    const job=await begun();await repo.saveSession(job,session(job.id));
    await database.client`update organization_members set role='VIEWER' where tenant_id=${tenant} and user_id=${user}`;
    await expect(repo.prepare(job,policies)).rejects.toThrow('NOT_AUTHORIZED');await repo.acknowledge(job,{state:'UPLOADING',nextByte:512,retryAfterSeconds:null});
    await database.client`update organization_members set role='OWNER' where tenant_id=${tenant} and user_id=${user}`;
    await database.client`update consent_records set revoked_at=now(),revoked_by_user_id=${user} where id=${consentId}`;
    await expect(new YouTubeResolutionRepository(database.db).complete(actor,{tenantId:tenant,jobId:resolutionJob.id,expectedRevision:Number(checkpoint!.revision),ticket:'CONSENT-44',idempotencyKey:randomUUID()},remote(resolutionJob.id),new Date(),policies,correlation)).rejects.toThrow('CONSENT_REQUIRED');
    expect(await database.client`select id from publications where job_id=${resolutionJob.id}`).toHaveLength(0);
    await expect(repo.prepare(job,policies)).rejects.toThrow('CONSENT_REQUIRED');await repo.reconcile(job,'CONSENT_REQUIRED');expect(await state(job.id)).toBe('RECONCILIATION');
  });
});
