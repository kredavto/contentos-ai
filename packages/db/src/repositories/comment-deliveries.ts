import {randomUUID} from 'node:crypto';
import {and,asc,desc,eq,lte,or,sql,inArray} from 'drizzle-orm';
import {DomainError,commentReplyApprovalBindingSchema,youtubeCommentReplyInputSchema} from '@contentos/types';
import type {Database} from '../index';
import {commentDeliveries,commentReplyApprovals,commentReplyApprovalRevocations,commentReplyVersions,comments,auditLogs,publications,publishingJobs} from '../schema';
import {assertPlatformOperator} from './admin';
import {lockTenant,type Transaction} from './ledger';
import {authorizeCommentImport} from './comment-imports';
import {commentReplyApprovalBinding} from './comment-reply-approvals';
export type CommentDelivery=typeof commentDeliveries.$inferSelect;
const where=(tenantId:string,id:string)=>and(eq(commentDeliveries.tenantId,tenantId),eq(commentDeliveries.id,id));
const summary=(row:CommentDelivery)=>({id:row.id,status:row.status,createdAt:row.createdAt,updatedAt:row.updatedAt,errorCode:row.errorCode});
async function clock(tx:Transaction){const [row]=await tx.select({now:sql<Date>`clock_timestamp()`}).from(commentDeliveries).limit(1);return new Date(row!.now);}
async function approvedTarget(tx:Transaction,actorId:string,tenantId:string,brandId:string,approvalId:string,receiptOnly=false){
 const [approval]=await tx.select().from(commentReplyApprovals).where(and(eq(commentReplyApprovals.tenantId,tenantId),eq(commentReplyApprovals.id,approvalId)));
 if(!approval)throw new DomainError('NOT_FOUND',404);
 await authorizeCommentImport(tx,actorId,tenantId,brandId,approval.publicationId,true);
 const [revoked]=await tx.select({id:commentReplyApprovalRevocations.id}).from(commentReplyApprovalRevocations).where(and(eq(commentReplyApprovalRevocations.tenantId,tenantId),eq(commentReplyApprovalRevocations.approvalId,approvalId)));
 if(revoked&&!receiptOnly)throw new DomainError('CONFLICT',409);
 // Recording a historical remote fact must not revive or require a current approval.
 const current=receiptOnly?{draftId:approval.draftId,binding:commentReplyApprovalBindingSchema.parse(approval.binding)}:await commentReplyApprovalBinding(tx,approval.approvedBy,tenantId,brandId,approval.publicationId,approval.commentId,approval.version,approval.draftRevision);
 if(current.draftId!==approval.draftId||JSON.stringify(current.binding)!==JSON.stringify(commentReplyApprovalBindingSchema.parse(approval.binding)))throw new DomainError('CONFLICT',409);
 const [version]=await tx.select().from(commentReplyVersions).where(and(eq(commentReplyVersions.tenantId,tenantId),eq(commentReplyVersions.draftId,approval.draftId),eq(commentReplyVersions.version,approval.version)));
 const [root]=await tx.select().from(comments).where(and(eq(comments.tenantId,tenantId),eq(comments.id,current.binding.rootId)));
 const input=youtubeCommentReplyInputSchema.parse({parentId:root?.externalCommentId,channelId:current.binding.channel.externalId,text:version?.content.reply});
 return {brandId,commentId:approval.commentId,publicationId:approval.publicationId,connectionId:current.binding.connectionId,credentialVersion:current.binding.credentialVersion,input};
}
export class CommentDeliveryRepository{
 constructor(private readonly db:Database){}
 async request(actorId:string,tenantId:string,brandId:string,approvalId:string,key:string,correlationId:string,expected?:{publicationId:string;commentId:string}){return this.db.transaction(async tx=>{
  await lockTenant(tx,tenantId);const target=await approvedTarget(tx,actorId,tenantId,brandId,approvalId);if(expected&&(target.publicationId!==expected.publicationId||target.commentId!==expected.commentId))throw new DomainError('NOT_FOUND',404);
  const [existing]=await tx.select().from(commentDeliveries).where(and(eq(commentDeliveries.tenantId,tenantId),or(eq(commentDeliveries.idempotencyKey,key),eq(commentDeliveries.approvalId,approvalId))));
  if(existing){if(existing.approvalId!==approvalId||existing.requestedBy!==actorId||existing.idempotencyKey!==key)throw new DomainError('CONFLICT',409);return summary(existing);}
  const [approval]=await tx.select().from(commentReplyApprovals).where(and(eq(commentReplyApprovals.tenantId,tenantId),eq(commentReplyApprovals.id,approvalId)));
  const [prior]=await tx.select({id:commentDeliveries.id}).from(commentDeliveries).innerJoin(commentReplyApprovals,and(eq(commentReplyApprovals.tenantId,commentDeliveries.tenantId),eq(commentReplyApprovals.id,commentDeliveries.approvalId))).where(and(eq(commentDeliveries.tenantId,tenantId),eq(commentReplyApprovals.draftId,approval!.draftId),or(eq(commentReplyApprovals.version,approval!.version),inArray(commentDeliveries.status,['QUEUED','ATTEMPTED','RECONCILIATION_REQUIRED'])))).limit(1);
  if(prior)throw new DomainError('CONFLICT',409);
  const pending=await tx.select({id:commentDeliveries.id}).from(commentDeliveries).where(and(eq(commentDeliveries.tenantId,tenantId),inArray(commentDeliveries.status,['QUEUED','ATTEMPTED']))).limit(25);if(pending.length>=25)throw new DomainError('RATE_LIMITED',429);
  const [row]=await tx.insert(commentDeliveries).values({tenantId,approvalId,requestedBy:actorId,idempotencyKey:key,correlationId}).returning();
  await this.audit(tx,row!,'QUEUED');return summary(row!);
 });}
 async latest(actorId:string,tenantId:string,brandId:string,publicationId:string,commentId:string){return this.db.transaction(async tx=>{
  await authorizeCommentImport(tx,actorId,tenantId,brandId,publicationId);
  const [comment]=await tx.select({id:comments.id}).from(comments).where(and(eq(comments.tenantId,tenantId),eq(comments.publicationId,publicationId),eq(comments.id,commentId)));if(!comment)throw new DomainError('NOT_FOUND',404);
  const [row]=await tx.select({job:commentDeliveries}).from(commentDeliveries).innerJoin(commentReplyApprovals,and(eq(commentReplyApprovals.tenantId,commentDeliveries.tenantId),eq(commentReplyApprovals.id,commentDeliveries.approvalId))).where(and(eq(commentDeliveries.tenantId,tenantId),eq(commentReplyApprovals.publicationId,publicationId),eq(commentReplyApprovals.commentId,commentId))).orderBy(desc(commentDeliveries.createdAt),desc(commentDeliveries.id)).limit(1);
  return row?{...summary(row.job),approvalId:row.job.approvalId,externalCommentId:row.job.externalCommentId,publishedAt:row.job.publishedAt}:null;
 });}
 private async audit(tx:Transaction,row:CommentDelivery,status:CommentDelivery['status']){await tx.insert(auditLogs).values({tenantId:row.tenantId,userId:row.requestedBy,resourceId:row.id,action:`COMMENT_DELIVERY_${status}`,correlationId:row.correlationId,metadata:{status}});}
 async due(){return this.db.select({tenantId:commentDeliveries.tenantId,id:commentDeliveries.id}).from(commentDeliveries).where(and(lte(commentDeliveries.dispatchAfter,sql`now()`),or(eq(commentDeliveries.status,'QUEUED'),and(eq(commentDeliveries.status,'ATTEMPTED'),lte(commentDeliveries.leaseExpiresAt,sql`now()`))))).orderBy(asc(commentDeliveries.dispatchAfter),asc(commentDeliveries.id)).limit(25);}
 async dispatched(tenantId:string,id:string){await this.db.update(commentDeliveries).set({dispatchAfter:sql`now()+interval '10 seconds'`}).where(and(where(tenantId,id),inArray(commentDeliveries.status,['QUEUED','ATTEMPTED'])));}
 async prepare(tenantId:string,id:string,brandId:string){return this.db.transaction(async tx=>{
  await lockTenant(tx,tenantId);const [row]=await tx.select().from(commentDeliveries).where(where(tenantId,id)).for('update');if(!row)return null;
  const now=await clock(tx);
  if(row.status==='ATTEMPTED'&&row.leaseExpiresAt&&row.leaseExpiresAt<=now){await tx.update(commentDeliveries).set({status:'RECONCILIATION_REQUIRED',leaseExpiresAt:null,errorCode:'RECONCILIATION_REQUIRED',updatedAt:now}).where(where(tenantId,id));await this.audit(tx,row,'RECONCILIATION_REQUIRED');return null;}
  if(row.status!=='QUEUED')return null;
  return {job:row,target:await approvedTarget(tx,row.requestedBy,tenantId,brandId,row.approvalId)};
 });}
 /** Internal lookup derives brand from persisted publication; never trust queue payload scope. */
 async lookup(tenantId:string,id:string){const [row]=await this.db.select({job:commentDeliveries,brandId:publishingJobs.brandId}).from(commentDeliveries).innerJoin(commentReplyApprovals,and(eq(commentReplyApprovals.tenantId,commentDeliveries.tenantId),eq(commentReplyApprovals.id,commentDeliveries.approvalId))).innerJoin(publications,and(eq(publications.tenantId,commentReplyApprovals.tenantId),eq(publications.id,commentReplyApprovals.publicationId))).innerJoin(publishingJobs,and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId))).where(where(tenantId,id));return row??null;}
 async attempt(tenantId:string,id:string,brandId:string){return this.db.transaction(async tx=>{
  await lockTenant(tx,tenantId);const [row]=await tx.select().from(commentDeliveries).where(where(tenantId,id)).for('update');if(!row||row.status!=='QUEUED')return null;
  const target=await approvedTarget(tx,row.requestedBy,tenantId,brandId,row.approvalId),now=await clock(tx);
  const [job]=await tx.update(commentDeliveries).set({status:'ATTEMPTED',attemptId:randomUUID(),attemptedAt:now,leaseExpiresAt:new Date(now.getTime()+120000),updatedAt:now}).where(where(tenantId,id)).returning();await this.audit(tx,job!,'ATTEMPTED');return {job:job!,target};
 });}
 private async resolutionTarget(tx:Transaction,actorId:string,tenantId:string,id:string,attemptId:string){
  if((await assertPlatformOperator(tx,actorId)).role!=='ADMIN')throw new DomainError('NOT_AUTHORIZED',403);
  await lockTenant(tx,tenantId);
  const [row]=await tx.select({job:commentDeliveries,brandId:publishingJobs.brandId}).from(commentDeliveries).innerJoin(commentReplyApprovals,and(eq(commentReplyApprovals.tenantId,commentDeliveries.tenantId),eq(commentReplyApprovals.id,commentDeliveries.approvalId))).innerJoin(publications,and(eq(publications.tenantId,commentReplyApprovals.tenantId),eq(publications.id,commentReplyApprovals.publicationId))).innerJoin(publishingJobs,and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId))).where(where(tenantId,id));
  if(!row)throw new DomainError('NOT_FOUND',404);
  if(row.job.attemptId!==attemptId||!row.job.attemptedAt||!['RECONCILIATION_REQUIRED','SUCCEEDED'].includes(row.job.status))throw new DomainError('RECONCILIATION_REQUIRED',409);
  return {...row,target:await approvedTarget(tx,row.job.requestedBy,tenantId,row.brandId,row.job.approvalId,true)};
 }
 async prepareResolution(actorId:string,tenantId:string,id:string,attemptId:string,externalId:string,ticket:string,correlationId:string){return this.db.transaction(async tx=>{
  const prepared=await this.resolutionTarget(tx,actorId,tenantId,id,attemptId);
  if(prepared.job.status==='SUCCEEDED'){
   if(prepared.job.externalCommentId!==externalId)throw new DomainError('CONFLICT',409);
   return {completed:true as const,...prepared};
  }
  await tx.insert(auditLogs).values({tenantId,userId:actorId,resourceId:id,action:'ADMIN_COMMENT_DELIVERY_CHECK',correlationId,metadata:{attemptId,externalId,ticket}});
  return {completed:false as const,...prepared};
 });}
 async completeResolution(actorId:string,tenantId:string,id:string,attemptId:string,externalId:string,publishedAt:Date,ticket:string,correlationId:string){return this.db.transaction(async tx=>{
  const prepared=await this.resolutionTarget(tx,actorId,tenantId,id,attemptId),now=await clock(tx);
  if(prepared.job.status==='SUCCEEDED'){if(prepared.job.externalCommentId!==externalId)throw new DomainError('CONFLICT',409);return summary(prepared.job);}
  const [used]=await tx.select({id:commentDeliveries.id}).from(commentDeliveries).where(and(eq(commentDeliveries.tenantId,tenantId),eq(commentDeliveries.externalCommentId,externalId))).limit(1);if(used&&used.id!==id)throw new DomainError('CONFLICT',409);
  const timestamp=publishedAt.getTime(),start=prepared.job.attemptedAt!.getTime();
  if(!Number.isFinite(timestamp)||timestamp<start-5000||timestamp>start+120000||timestamp>now.getTime()+5000)throw new DomainError('RECONCILIATION_REQUIRED',409);
  const [updated]=await tx.update(commentDeliveries).set({status:'SUCCEEDED',externalCommentId:externalId,publishedAt,errorCode:null,leaseExpiresAt:null,updatedAt:now}).where(where(tenantId,id)).returning();
  await tx.insert(auditLogs).values({tenantId,userId:actorId,resourceId:id,action:'ADMIN_COMMENT_DELIVERY_RESOLVED',correlationId,metadata:{attemptId,externalId,ticket}});return summary(updated!);
 });}
 async finish(job:CommentDelivery,outcome:{status:'REJECTED'|'RECONCILIATION_REQUIRED';code:string}|{status:'SUCCEEDED';externalId:string;publishedAt:Date}){return this.db.transaction(async tx=>{
  await lockTenant(tx,job.tenantId);const [current]=await tx.select().from(commentDeliveries).where(where(job.tenantId,job.id)).for('update');
  if(!current||current.attemptId!==job.attemptId||!['QUEUED','ATTEMPTED','RECONCILIATION_REQUIRED'].includes(current.status))return;
  if(current.status==='RECONCILIATION_REQUIRED'&&outcome.status!=='SUCCEEDED')return;
  if(outcome.status==='SUCCEEDED'&&!current.attemptId)throw new DomainError('CONFLICT',409);
  const now=await clock(tx);await tx.update(commentDeliveries).set({status:outcome.status,leaseExpiresAt:null,updatedAt:now,errorCode:outcome.status==='SUCCEEDED'?null:outcome.code,...(outcome.status==='SUCCEEDED'?{externalCommentId:outcome.externalId,publishedAt:outcome.publishedAt}:{})}).where(where(job.tenantId,job.id));await this.audit(tx,current,outcome.status);
 });}
}
