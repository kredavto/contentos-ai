import {randomUUID} from 'node:crypto';
import {and,asc,desc,eq,gte,inArray,isNull,lte,or} from 'drizzle-orm';
import {DomainError,commentImportPositionSchema,commentImportRequestSchema,youtubeVideoIdSchema,youtubeChannelIdSchema,type ErrorCode} from '@contentos/types';
import type {Database} from '../index';
import {commentImports,publications,publishingJobs,socialConnections,auditLogs,comments} from '../schema';
import {authorizeSocial} from './social';
import {lockTenant,type Transaction} from './ledger';
export type CommentImportJob=typeof commentImports.$inferSelect;
export const commentImportWhere=(tenantId:string,id:string)=>and(eq(commentImports.tenantId,tenantId),eq(commentImports.id,id));
export function commentImportSummary(job:CommentImportJob){return {id:job.id,publicationId:job.publicationId,status:job.status,revision:job.revision,completedPages:job.completedPages,remainingPages:job.remainingPages,attempt:job.attempt,errorCode:job.errorCode,createdAt:job.createdAt,updatedAt:job.updatedAt,finishedAt:job.finishedAt,nextAttemptAt:job.nextAttemptAt};}
export async function authorizeCommentImport(tx:Transaction,userId:string,tenantId:string,brandId:string,publicationId:string,manage=false){
 await authorizeSocial(tx,userId,tenantId,brandId,manage);
 const [row]=await tx.select({publication:publications,job:publishingJobs}).from(publications).innerJoin(publishingJobs,and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId))).where(and(eq(publications.tenantId,tenantId),eq(publications.id,publicationId),eq(publishingJobs.brandId,brandId)));
 if(!row)throw new DomainError('NOT_FOUND',404);
 if(row.publication.provider!=='youtube'||row.job.provider!=='youtube'||row.publication.reference.provider!=='youtube'||row.publication.reference.metadata.demo===true)throw new DomainError('CONFIGURATION_REQUIRED',503);
 return row;
}
async function target(tx:Transaction,userId:string,tenantId:string,brandId:string,publicationId:string){
 const row=await authorizeCommentImport(tx,userId,tenantId,brandId,publicationId,true);
 const [connection]=await tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.id,row.job.connectionId),eq(socialConnections.brandId,brandId)));
 if(!connection||connection.provider!=='youtube'||connection.reference.provider!=='youtube'||connection.reference.metadata.demo===true)throw new DomainError('CONFIGURATION_REQUIRED',503);
 if(connection.status!=='ACTIVE'||!connection.credential)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);
 // Conservative additional gate; the worker must also validate the encrypted granted scopes.
 if(connection.reference.metadata.commentsAuthorized!==true)throw new DomainError('NOT_AUTHORIZED',403);
 const video=youtubeVideoIdSchema.safeParse(row.publication.reference.externalId),channel=youtubeChannelIdSchema.safeParse(connection.reference.externalId);
 if(!video.success||!channel.success)throw new DomainError('PROVIDER_REJECTED',502);
 return {connectionId:connection.id,credentialVersion:connection.credentialVersion,videoId:video.data,channelId:channel.data};
}
export async function permittedCommentImport(tx:Transaction,job:CommentImportJob){
 const current=await target(tx,job.requestedBy,job.tenantId,job.brandId,job.publicationId);
 if(current.connectionId!==job.connectionId||current.credentialVersion!==job.credentialVersion)throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);
 if(current.videoId!==job.videoId||current.channelId!==job.channelId)throw new DomainError('CONFLICT',409);
 return current;
}
export async function ownedCommentImport(tx:Transaction,job:CommentImportJob,now:Date){
 const [current]=await tx.select().from(commentImports).where(commentImportWhere(job.tenantId,job.id)).for('update');
 if(!current||current.status!=='RUNNING'||!job.leaseToken||current.leaseToken!==job.leaseToken||!current.leaseExpiresAt||current.leaseExpiresAt<=now)throw new DomainError('CONFLICT',409);
 return current;
}
export class CommentImportRepository{
 constructor(private readonly db:Database,private readonly now=()=>new Date()){}
 private async audit(tx:Transaction,job:CommentImportJob,status:CommentImportJob['status'],code:ErrorCode|null,actor=job.requestedBy){
  await tx.insert(auditLogs).values({tenantId:job.tenantId,userId:actor,resourceId:job.id,action:`COMMENT_IMPORT_${status}`,correlationId:job.correlationId,metadata:{from:job.status,to:status,attempt:job.attempt,completedPages:job.completedPages,code}});
 }
 private async finish(tx:Transaction,job:CommentImportJob,status:'FAILED'|'CANCELLED',code:ErrorCode|null,actor=job.requestedBy){
  const now=this.now();const [updated]=await tx.update(commentImports).set({status,errorCode:code,revision:job.revision+1,leaseToken:null,leaseExpiresAt:null,updatedAt:now,finishedAt:now}).where(commentImportWhere(job.tenantId,job.id)).returning();
  await this.audit(tx,job,status,code,actor);return updated!;
 }
 async latest(userId:string,tenantId:string,brandId:string,publicationId:string){return this.db.transaction(async tx=>{
  await authorizeCommentImport(tx,userId,tenantId,brandId,publicationId);
  const [job]=await tx.select().from(commentImports).where(and(eq(commentImports.tenantId,tenantId),eq(commentImports.brandId,brandId),eq(commentImports.publicationId,publicationId))).orderBy(desc(commentImports.createdAt),desc(commentImports.id)).limit(1);
  return job?commentImportSummary(job):null;
 });}
 async request(userId:string,tenantId:string,brandId:string,publicationId:string,key:string,correlationId:string){
  commentImportRequestSchema.parse({idempotencyKey:key});
  return this.db.transaction(async tx=>{
   await lockTenant(tx,tenantId);await authorizeCommentImport(tx,userId,tenantId,brandId,publicationId,true);
   const [existing]=await tx.select().from(commentImports).where(and(eq(commentImports.tenantId,tenantId),eq(commentImports.idempotencyKey,key)));
   if(existing){if(existing.requestedBy!==userId||existing.brandId!==brandId||existing.publicationId!==publicationId)throw new DomainError('CONFLICT',409);return commentImportSummary(existing);}
   const current=await target(tx,userId,tenantId,brandId,publicationId);
   const pending=await tx.select({publicationId:commentImports.publicationId}).from(commentImports).where(and(eq(commentImports.tenantId,tenantId),inArray(commentImports.status,['QUEUED','RUNNING','PARTIAL']))).limit(26);
   if(pending.some(job=>job.publicationId===publicationId))throw new DomainError('CONFLICT',409);
   if(pending.length>=25)throw new DomainError('RATE_LIMITED',429);
   const [recent]=await tx.select({id:commentImports.id}).from(commentImports).where(and(eq(commentImports.tenantId,tenantId),eq(commentImports.publicationId,publicationId),gte(commentImports.createdAt,new Date(this.now().getTime()-60000)))).limit(1);
   if(recent)throw new DomainError('RATE_LIMITED',429);
   const now=this.now(),[job]=await tx.insert(commentImports).values({tenantId,brandId,publicationId,...current,requestedBy:userId,idempotencyKey:key,correlationId,createdAt:now,updatedAt:now,nextAttemptAt:now,dispatchAfter:now}).returning();
   await this.audit(tx,job!,'QUEUED',null);return commentImportSummary(job!);
  });
 }
 /** Internal outbox dispatcher only; no HTTP route exposes raw job positions. */
 async due(){const now=this.now();return this.db.select({tenantId:commentImports.tenantId,id:commentImports.id}).from(commentImports).where(and(lte(commentImports.dispatchAfter,now),or(and(eq(commentImports.status,'QUEUED'),lte(commentImports.nextAttemptAt,now)),and(eq(commentImports.status,'RUNNING'),lte(commentImports.leaseExpiresAt,now))))).orderBy(asc(commentImports.nextAttemptAt),asc(commentImports.id)).limit(25);}
 async dispatched(tenantId:string,id:string){await this.db.update(commentImports).set({dispatchAfter:new Date(this.now().getTime()+10000)}).where(and(commentImportWhere(tenantId,id),inArray(commentImports.status,['QUEUED','RUNNING'])));}
 async claim(tenantId:string,id:string){return this.db.transaction(async tx=>{
  await lockTenant(tx,tenantId);const [job]=await tx.select().from(commentImports).where(commentImportWhere(tenantId,id)).for('update');const now=this.now();
  if(!job||!['QUEUED','RUNNING'].includes(job.status)||job.nextAttemptAt>now||(job.status==='RUNNING'&&job.leaseExpiresAt&&job.leaseExpiresAt>now))return null;
  if(job.attempt>=3){await this.finish(tx,job,'FAILED','PROVIDER_UNAVAILABLE');return null;}
  if(!commentImportPositionSchema.safeParse(job.position).success){await this.finish(tx,job,'FAILED','PROVIDER_REJECTED');return null;}
  const [claimed]=await tx.update(commentImports).set({status:'RUNNING',attempt:job.attempt+1,revision:job.revision+1,leaseToken:randomUUID(),leaseExpiresAt:new Date(now.getTime()+120000),startedAt:now,updatedAt:now}).where(commentImportWhere(tenantId,id)).returning();
  await this.audit(tx,{...job,attempt:job.attempt+1},'RUNNING',null);return claimed!;
 });}
 async prepare(job:CommentImportJob){return this.db.transaction(async tx=>{await lockTenant(tx,job.tenantId);const current=await ownedCommentImport(tx,job,this.now());await permittedCommentImport(tx,current);return current;});}
 /** Resolve reply identity only under the current lease and publication authorization. */
 async preparePage(job:CommentImportJob){return this.db.transaction(async tx=>{
  await lockTenant(tx,job.tenantId);const current=await ownedCommentImport(tx,job,this.now());await permittedCommentImport(tx,current);
  if(current.revision!==job.revision)throw new DomainError('CONFLICT',409);
  const parsed=commentImportPositionSchema.safeParse(current.position);if(!parsed.success)throw new DomainError('PROVIDER_REJECTED',502);
  const position=parsed.data;
  if(position.kind==='THREADS')return {position,externalId:current.videoId,channelId:current.channelId};
  const [parent]=await tx.select({externalId:comments.externalCommentId}).from(comments).where(and(eq(comments.tenantId,current.tenantId),eq(comments.publicationId,current.publicationId),eq(comments.provider,'youtube'),eq(comments.id,position.parentId),isNull(comments.parentId)));
  if(!parent)throw new DomainError('PROVIDER_REJECTED',502);
  return {position,externalId:parent.externalId,channelId:current.channelId};
 });}
 async fail(job:CommentImportJob,code:ErrorCode){return this.db.transaction(async tx=>{
  await lockTenant(tx,job.tenantId);const [current]=await tx.select().from(commentImports).where(commentImportWhere(job.tenantId,job.id)).for('update');const now=this.now();
  if(!current||current.status!=='RUNNING'||current.leaseToken!==job.leaseToken||!current.leaseExpiresAt||current.leaseExpiresAt<=now)return;
  if(['PROVIDER_UNAVAILABLE','RATE_LIMITED'].includes(code)&&current.attempt<3){
   const delay=code==='RATE_LIMITED'?60000:5000*2**current.attempt;
   await tx.update(commentImports).set({status:'QUEUED',revision:current.revision+1,errorCode:code,leaseToken:null,leaseExpiresAt:null,nextAttemptAt:new Date(now.getTime()+delay),dispatchAfter:now,updatedAt:now}).where(commentImportWhere(job.tenantId,job.id));
   await this.audit(tx,current,'QUEUED',code);
  }else await this.finish(tx,current,['NOT_AUTHORIZED','NOT_FOUND','SOCIAL_TOKEN_EXPIRED'].includes(code)?'CANCELLED':'FAILED',code);
 });}
 async resume(userId:string,tenantId:string,brandId:string,publicationId:string,id:string,revision:number){return this.db.transaction(async tx=>{
  await lockTenant(tx,tenantId);await authorizeCommentImport(tx,userId,tenantId,brandId,publicationId,true);
  const [job]=await tx.select().from(commentImports).where(and(commentImportWhere(tenantId,id),eq(commentImports.brandId,brandId),eq(commentImports.publicationId,publicationId))).for('update');
  if(!job)throw new DomainError('NOT_FOUND',404);
  if(job.requestedBy!==userId)throw new DomainError('NOT_AUTHORIZED',403);
  if(job.status!=='PARTIAL'||job.revision!==revision)throw new DomainError('CONFLICT',409);
  await permittedCommentImport(tx,job);if(!commentImportPositionSchema.safeParse(job.position).success)throw new DomainError('PROVIDER_REJECTED',502);
  const now=this.now(),[updated]=await tx.update(commentImports).set({status:'QUEUED',remainingPages:200,attempt:0,revision:job.revision+1,errorCode:null,nextAttemptAt:now,dispatchAfter:now,updatedAt:now}).where(commentImportWhere(tenantId,id)).returning();
  await this.audit(tx,job,'QUEUED',null,userId);return commentImportSummary(updated!);
 });}
 async cancel(userId:string,tenantId:string,brandId:string,publicationId:string,id:string,revision:number){return this.db.transaction(async tx=>{
  await lockTenant(tx,tenantId);await authorizeCommentImport(tx,userId,tenantId,brandId,publicationId,true);
  const [job]=await tx.select().from(commentImports).where(and(commentImportWhere(tenantId,id),eq(commentImports.brandId,brandId),eq(commentImports.publicationId,publicationId))).for('update');
  if(!job)throw new DomainError('NOT_FOUND',404);if(job.status==='CANCELLED')return commentImportSummary(job);
  if(!['QUEUED','RUNNING','PARTIAL'].includes(job.status)||job.revision!==revision)throw new DomainError('CONFLICT',409);
  return commentImportSummary(await this.finish(tx,job,'CANCELLED',null,userId));
 });}
}
