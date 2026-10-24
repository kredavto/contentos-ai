import {createHash,randomUUID} from 'node:crypto';
import {and,eq,desc,sql} from 'drizzle-orm';
import {DomainError,libraryUploadSchema,preparedMediaSchema,maxMediaSourceBytes,maxBrowserMediaBytes,mediaChunkIndexSchema,type LibraryUpload,type PreparedMedia,type ErrorCode} from '@contentos/types';
import type {Database} from '../index';
import {libraryMedia,brands,auditLogs} from '../schema';
import {assertMembership,lockTenant,type Transaction} from './ledger';

export type StoredLibraryMedia=typeof libraryMedia.$inferSelect;
const where=(tenantId:string,id:string)=>and(eq(libraryMedia.tenantId,tenantId),eq(libraryMedia.id,id));
export const libraryOutputKey=(row:StoredLibraryMedia,attempt=row.attempt)=>`${row.tenantId}/library/${row.id}/${attempt}.${row.sourceMime==='video/mp4'?'mp4':'mp3'}`;
export const libraryChunkKey=(row:StoredLibraryMedia,index:number)=>`${row.tenantId}/uploads/${row.id}/chunks/${mediaChunkIndexSchema.parse(index)}`;
async function brand(tx:Transaction,tenantId:string,id:string){
  const [row]=await tx.select({id:brands.id}).from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,id)));
  if(!row)throw new DomainError('NOT_FOUND',404);
}
// Processing and cleanup deadlines share PostgreSQL's clock across web/worker hosts.
// SET expressions read the old row, preserving the active lease's late-write fence.
function cleanupSchedule(){
  return {cleanupAfter:sql`greatest(clock_timestamp(), ${libraryMedia.uploadExpiresAt} + interval '1 minute', ${libraryMedia.leaseExpiresAt} + interval '1 minute', ${libraryMedia.cleanupExpiresAt} + interval '1 minute', ${libraryMedia.cleanupAfter})`,cleanupUntil:sql`clock_timestamp() + interval '24 hours'`};
}
async function audit(tx:Transaction,row:StoredLibraryMedia,action:string,userId?:string){
  await tx.insert(auditLogs).values({tenantId:row.tenantId,userId,action,resourceId:row.id,correlationId:row.correlationId});
}
async function terminal(tx:Transaction,row:StoredLibraryMedia,code:ErrorCode){
  await tx.update(libraryMedia).set({status:'FAILED',errorCode:code,leaseToken:null,leaseExpiresAt:null,finishedAt:sql`clock_timestamp()`,...cleanupSchedule()}).where(where(row.tenantId,row.id));
  await audit(tx,row,'LIBRARY_MEDIA_FAILED');
}
/** The QUEUED/RUNNING row is a transactional outbox; delivery never owns completion. */
export class LibraryMediaRepository{
  constructor(private readonly db:Database){}
  async authorize(userId:string,tenantId:string,brandId:string){
    await this.db.transaction(async tx=>{await assertMembership(tx,userId,tenantId,'generate');await brand(tx,tenantId,brandId);});
  }
  async list(userId:string,tenantId:string,brandId:string){return this.db.transaction(async tx=>{
    await assertMembership(tx,userId,tenantId);await brand(tx,tenantId,brandId);
    return tx.select({id:libraryMedia.id,name:libraryMedia.name,status:libraryMedia.status,sourceMime:libraryMedia.sourceMime,canResume:sql<boolean>`${libraryMedia.uploadedBy} = ${userId} and ${libraryMedia.status} = 'UPLOADING' and ${libraryMedia.uploadExpiresAt} > now() and (${libraryMedia.sourceBytes} <= ${maxBrowserMediaBytes} or cardinality(${libraryMedia.chunkHashes}) > 0)`,mimeType:libraryMedia.mimeType,bytes:libraryMedia.bytes,durationMs:libraryMedia.durationMs,width:libraryMedia.width,height:libraryMedia.height,hasAudio:libraryMedia.hasAudio,errorCode:libraryMedia.errorCode,createdAt:libraryMedia.createdAt}).from(libraryMedia).where(and(eq(libraryMedia.tenantId,tenantId),eq(libraryMedia.brandId,brandId),sql`${libraryMedia.status} <> 'DELETED'`)).orderBy(desc(libraryMedia.createdAt)).limit(100);
  });}
  async begin(userId:string,tenantId:string,brandId:string,raw:LibraryUpload,provider:string,correlationId:string){
    const input=libraryUploadSchema.parse(raw),inputHash=createHash('sha256').update(JSON.stringify({brandId,name:input.name,source:input.source,...(input.chunkHashes?{chunkHashes:input.chunkHashes}:{})})).digest('hex');
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');await brand(tx,tenantId,brandId);
      const [existing]=await tx.select().from(libraryMedia).where(and(eq(libraryMedia.tenantId,tenantId),eq(libraryMedia.idempotencyKey,input.idempotencyKey)));
      if(existing){
        if(existing.uploadedBy!==userId||existing.inputHash!==inputHash||existing.provider!==provider)throw new DomainError('CONFLICT',409);
        if(['DELETE_PENDING','DELETED'].includes(existing.status))throw new DomainError('CONFLICT',409);
        return existing;
      }
      // Separate bootstrap audio/video quota reserves space for every possible attempt.
      // Reservations persist through cleanup, including failed and cancelled work.
      const [usage]=await tx.select({bytes:sql<number>`coalesce(sum(${libraryMedia.sourceBytes} + ${maxMediaSourceBytes*3}),0)::float8`,count:sql<number>`count(*)::int`}).from(libraryMedia).where(and(eq(libraryMedia.tenantId,tenantId),sql`${libraryMedia.status} <> 'DELETED'`));
      if((usage?.bytes??0)+input.source.bytes+maxMediaSourceBytes*3>1024*1024*1024||(usage?.count??0)>=100)throw new DomainError('PLAN_LIMIT_REACHED',403);
      const id=randomUUID();
      const [row]=await tx.insert(libraryMedia).values({id,tenantId,brandId,uploadedBy:userId,name:input.name,provider,sourceKey:`${tenantId}/uploads/${id}/source`,sourceMime:input.source.mimeType,sourceBytes:input.source.bytes,sourceSha256:input.source.sha256,uploadExpiresAt:new Date(Date.now()+(input.chunkHashes?1_800_000:300_000)),chunkHashes:input.chunkHashes??[],inputHash,idempotencyKey:input.idempotencyKey,correlationId}).returning();
      await audit(tx,row!,'LIBRARY_MEDIA_UPLOAD_REQUESTED',userId);return row!;
    });
  }
  async uploadSource(userId:string,tenantId:string,brandId:string,id:string){return this.db.transaction(async tx=>{
    await assertMembership(tx,userId,tenantId,'generate');
    const [row]=await tx.select().from(libraryMedia).where(and(where(tenantId,id),eq(libraryMedia.brandId,brandId)));
    if(!row)throw new DomainError('NOT_FOUND',404);
    if(row.uploadedBy!==userId)throw new DomainError('NOT_AUTHORIZED',403);
    if(['DELETE_PENDING','DELETED'].includes(row.status)||(row.status==='UPLOADING'&&row.uploadExpiresAt.getTime()<=Date.now()))throw new DomainError('CONFLICT',409);
    return row;
  });}
  async recordChunk(userId:string,tenantId:string,brandId:string,id:string,index:number){
    mediaChunkIndexSchema.parse(index);
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
      const [row]=await tx.select().from(libraryMedia).where(and(where(tenantId,id),eq(libraryMedia.brandId,brandId)));
      if(!row)throw new DomainError('NOT_FOUND',404);
      if(row.uploadedBy!==userId)throw new DomainError('NOT_AUTHORIZED',403);
      if(!row.chunkHashes[index])throw new DomainError('INVALID_INPUT');
      if(['DELETE_PENDING','DELETED'].includes(row.status))throw new DomainError('CONFLICT',409);
      if(row.status!=='UPLOADING')return {id,status:row.status};
      if(row.uploadExpiresAt.getTime()<=Date.now())throw new DomainError('CONFLICT',409);
      if(!row.uploadedChunks.includes(index)){
        await tx.update(libraryMedia).set({uploadedChunks:[...row.uploadedChunks,index].sort((a,b)=>a-b)}).where(where(tenantId,id));
        await audit(tx,row,'LIBRARY_MEDIA_CHUNK_STORED',userId);
      }
      return {id,status:row.status};
    });
  }
  async confirm(userId:string,tenantId:string,brandId:string,id:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
    const [row]=await tx.select().from(libraryMedia).where(and(where(tenantId,id),eq(libraryMedia.brandId,brandId)));
    if(!row)throw new DomainError('NOT_FOUND',404);
    if(row.uploadedBy!==userId)throw new DomainError('NOT_AUTHORIZED',403);
    if(['QUEUED','RUNNING','READY','FAILED'].includes(row.status))return {id,status:row.status};
    if(row.status!=='UPLOADING'||row.uploadExpiresAt.getTime()+60_000<=Date.now())throw new DomainError('CONFLICT',409);
    if(row.chunkHashes.some((_,index)=>!row.uploadedChunks.includes(index)))throw new DomainError('CONFLICT',409);
    await tx.update(libraryMedia).set({status:'QUEUED',dispatchAfter:sql`clock_timestamp()`,nextAttemptAt:sql`clock_timestamp()`}).where(where(tenantId,id));
    await audit(tx,row,'LIBRARY_MEDIA_QUEUED',userId);return {id,status:'QUEUED' as const};
  });}
  async ready(userId:string,tenantId:string,brandId:string,id:string){return this.db.transaction(async tx=>{
    await assertMembership(tx,userId,tenantId);
    const [row]=await tx.select().from(libraryMedia).where(and(where(tenantId,id),eq(libraryMedia.brandId,brandId),eq(libraryMedia.status,'READY')));
    if(!row)throw new DomainError('NOT_FOUND',404);return row;
  });}
  async requestDeletion(userId:string,tenantId:string,brandId:string,id:string,correlationId:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);await assertMembership(tx,userId,tenantId,'generate');
    const [row]=await tx.select().from(libraryMedia).where(and(where(tenantId,id),eq(libraryMedia.brandId,brandId))).for('update');
    if(!row)throw new DomainError('NOT_FOUND',404);
    if(['DELETE_PENDING','DELETED'].includes(row.status))return {status:row.status};
    await tx.update(libraryMedia).set({status:'DELETE_PENDING',leaseToken:null,leaseExpiresAt:null,cleanupToken:null,cleanupExpiresAt:null,correlationId,...cleanupSchedule()}).where(where(tenantId,id));
    await audit(tx,{...row,correlationId},'LIBRARY_MEDIA_DELETION_REQUESTED',userId);return {status:'DELETE_PENDING' as const};
  });}
  async due(provider:string){return this.db.select({tenantId:libraryMedia.tenantId,id:libraryMedia.id}).from(libraryMedia).where(and(eq(libraryMedia.provider,provider),sql`${libraryMedia.dispatchAfter} <= statement_timestamp()`,sql`((${libraryMedia.status} = 'QUEUED' and ${libraryMedia.nextAttemptAt} <= statement_timestamp()) or (${libraryMedia.status} = 'RUNNING' and ${libraryMedia.leaseExpiresAt} <= statement_timestamp()))`)).orderBy(libraryMedia.nextAttemptAt).limit(25);}
  async dispatched(tenantId:string,id:string){await this.db.update(libraryMedia).set({dispatchAfter:sql`clock_timestamp() + interval '10 seconds'`}).where(where(tenantId,id));}
  async claim(tenantId:string,id:string,provider:string){return this.db.transaction(async tx=>{
    await lockTenant(tx,tenantId);
    const [row]=await tx.select().from(libraryMedia).where(and(where(tenantId,id),eq(libraryMedia.provider,provider),sql`${libraryMedia.nextAttemptAt} <= clock_timestamp()`,sql`(${libraryMedia.status} = 'QUEUED' or (${libraryMedia.status} = 'RUNNING' and ${libraryMedia.leaseExpiresAt} <= clock_timestamp()))`));
    if(!row)return null;
    if(row.attempt>=3){await terminal(tx,row,'PROVIDER_UNAVAILABLE');return null;}
    const [claimed]=await tx.update(libraryMedia).set({status:'RUNNING',attempt:row.attempt+1,leaseToken:randomUUID(),leaseExpiresAt:sql`clock_timestamp() + interval '5 minutes'`,errorCode:null}).where(where(tenantId,id)).returning();
    await audit(tx,claimed!,'LIBRARY_MEDIA_RUNNING');return claimed!;
  });}
  private async owned(tx:Transaction,job:StoredLibraryMedia){
    if(!job.leaseToken)throw new DomainError('CONFLICT',409);
    const [row]=await tx.select().from(libraryMedia).where(and(where(job.tenantId,job.id),eq(libraryMedia.status,'RUNNING'),eq(libraryMedia.leaseToken,job.leaseToken),sql`${libraryMedia.leaseExpiresAt} > clock_timestamp()`));
    if(!row)throw new DomainError('CONFLICT',409);
    return row;
  }
  async prepare(job:StoredLibraryMedia){await this.db.transaction(async tx=>{
    await lockTenant(tx,job.tenantId);await this.owned(tx,job);await assertMembership(tx,job.uploadedBy,job.tenantId,'generate');
  });}
  async complete(job:StoredLibraryMedia,raw:PreparedMedia){
    const output=preparedMediaSchema.parse(raw);
    if((job.sourceMime==='video/mp4')!==(output.mimeType==='video/mp4'))throw new DomainError('INVALID_MEDIA',422);
    await this.db.transaction(async tx=>{
      await lockTenant(tx,job.tenantId);const row=await this.owned(tx,job);await assertMembership(tx,job.uploadedBy,job.tenantId,'generate');
      await tx.update(libraryMedia).set({...output,status:'READY',storageKey:libraryOutputKey(job),leaseToken:null,leaseExpiresAt:null,finishedAt:sql`clock_timestamp()`,...cleanupSchedule()}).where(where(job.tenantId,job.id));
      await audit(tx,row,'LIBRARY_MEDIA_READY');
    });
  }
  async fail(job:StoredLibraryMedia,code:ErrorCode){await this.db.transaction(async tx=>{
    await lockTenant(tx,job.tenantId);const row=await this.owned(tx,job);
    if(code!=='PROVIDER_UNAVAILABLE'||row.attempt>=3){await terminal(tx,row,code);return;}
    await tx.update(libraryMedia).set({status:'QUEUED',leaseToken:null,leaseExpiresAt:null,...cleanupSchedule(),errorCode:code,nextAttemptAt:sql`clock_timestamp() + ${5000*2**row.attempt} * interval '1 millisecond'`,dispatchAfter:sql`clock_timestamp()`}).where(where(row.tenantId,row.id));
    await audit(tx,row,'LIBRARY_MEDIA_RETRY');
  });}
  async claimCleanup(provider:string){return this.db.transaction(async tx=>{
    // Upload capabilities cannot be refreshed. An abandoned intent is eventually scrubbed.
    await tx.update(libraryMedia).set({status:'DELETE_PENDING',cleanupAfter:sql`clock_timestamp()`,cleanupUntil:sql`clock_timestamp() + interval '24 hours'`}).where(and(eq(libraryMedia.provider,provider),eq(libraryMedia.status,'UPLOADING'),sql`${libraryMedia.uploadExpiresAt} < statement_timestamp() - interval '10 minutes'`));
    const [row]=await tx.select().from(libraryMedia).where(and(eq(libraryMedia.provider,provider),sql`${libraryMedia.status} in ('READY','FAILED','DELETE_PENDING','DELETED')`,sql`${libraryMedia.cleanupAfter} <= statement_timestamp()`,sql`(${libraryMedia.cleanupExpiresAt} is null or ${libraryMedia.cleanupExpiresAt} <= statement_timestamp())`)).orderBy(libraryMedia.cleanupAfter).for('update',{skipLocked:true}).limit(1);
    if(!row)return null;
    const [claimed]=await tx.update(libraryMedia).set({cleanupToken:randomUUID(),cleanupExpiresAt:sql`clock_timestamp() + interval '2 minutes'`,cleanupAttempts:row.cleanupAttempts+1}).where(where(row.tenantId,row.id)).returning();return claimed!;
  });}
  async finishCleanup(job:StoredLibraryMedia,succeeded:boolean){await this.db.transaction(async tx=>{
    await lockTenant(tx,job.tenantId);
    const deleting=job.status==='DELETE_PENDING'||job.status==='DELETED';
    const [updated]=await tx.update(libraryMedia).set({cleanupToken:null,cleanupExpiresAt:null,cleanupAfter:succeeded?sql`case when ${libraryMedia.cleanupUntil} > clock_timestamp() then clock_timestamp() + interval '1 hour' else null end`:sql`clock_timestamp() + ${Math.min(3_600_000,5000*2**Math.min(job.cleanupAttempts,10))} * interval '1 millisecond'`,...(succeeded&&deleting?{status:'DELETED' as const,name:'[deleted]',sourceSha256:'0'.repeat(64),chunkHashes:job.chunkHashes.map(()=>'0'.repeat(64)),uploadedChunks:[],storageKey:null,mimeType:null,bytes:null,durationMs:null,width:null,height:null,hasAudio:null,errorCode:null,deletedAt:sql`coalesce(${libraryMedia.deletedAt}, clock_timestamp())`}:{} )}).where(and(where(job.tenantId,job.id),eq(libraryMedia.cleanupToken,job.cleanupToken!),sql`${libraryMedia.cleanupExpiresAt} > clock_timestamp()`)).returning({id:libraryMedia.id});
    if(!updated)throw new DomainError('CONFLICT',409);
    if(succeeded&&deleting&&!job.deletedAt)await audit(tx,job,'LIBRARY_MEDIA_DELETED');
  });}
}
