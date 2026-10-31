import {assertManagedFeature} from './feature-policy';
import {createHash} from 'node:crypto';
import {and,desc,eq} from 'drizzle-orm';
import {DomainError,commentReplyApprovalSchema,commentReplyApprovalBindingSchema,type CommentReplyApproval} from '@contentos/types';
import type {Database} from '../index';
import {comments,brands,socialConnections,commentReplyDrafts,commentReplyVersions,commentReplyApprovals,commentReplyApprovalRevocations,auditLogs} from '../schema';
import {lockTenant,assertMembership,type Transaction} from './ledger';
import {authorizeComment} from './comments';
import {authorizeCommentImport} from './comment-imports';
const scope=(tenantId:string,publicationId:string,commentId:string)=>and(eq(commentReplyApprovals.tenantId,tenantId),eq(commentReplyApprovals.publicationId,publicationId),eq(commentReplyApprovals.commentId,commentId));
export async function commentReplyApprovalBinding(tx:Transaction,actor:string,tenantId:string,brandId:string,publicationId:string,commentId:string,version:number,revision:number){
 await assertMembership(tx,actor,tenantId,'approve');
 const publication=await authorizeCommentImport(tx,actor,tenantId,brandId,publicationId);
 const [comment]=await tx.select().from(comments).where(and(eq(comments.tenantId,tenantId),eq(comments.publicationId,publicationId),eq(comments.id,commentId)));
 const [draft]=await tx.select().from(commentReplyDrafts).where(and(eq(commentReplyDrafts.tenantId,tenantId),eq(commentReplyDrafts.publicationId,publicationId),eq(commentReplyDrafts.commentId,commentId)));
 if(!comment||!draft)throw new DomainError('NOT_FOUND',404);
 if(draft.currentVersion!==version||draft.revision!==revision)throw new DomainError('CONFLICT',409);
 const [saved]=await tx.select().from(commentReplyVersions).where(and(eq(commentReplyVersions.tenantId,tenantId),eq(commentReplyVersions.draftId,draft.id),eq(commentReplyVersions.version,version)));
 const [brand]=await tx.select().from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId)));
 const [root]=await tx.select().from(comments).where(and(eq(comments.tenantId,tenantId),eq(comments.publicationId,publicationId),eq(comments.id,comment.parentId??comment.id)));
 if(!saved||!brand||!root||root.parentId||!root.canReply||!root.isPublic)throw new DomainError('CONFLICT',409);
 if(saved.content.reply===null||saved.input.brandRevision!==brand.revision||saved.input.comment.contentRevision!==comment.contentRevision||saved.input.comment.reviewRevision!==comment.revision||saved.input.comment.text!==comment.text||saved.input.comment.parentText!==(comment.parentId?root.text:null))throw new DomainError('CONFLICT',409);
 const [connection]=await tx.select().from(socialConnections).where(and(eq(socialConnections.tenantId,tenantId),eq(socialConnections.brandId,brandId),eq(socialConnections.id,publication.job.connectionId)));
 if(!connection||connection.status!=='ACTIVE'||!connection.credential||connection.provider!=='youtube'||connection.reference.provider!=='youtube'||connection.reference.metadata.demo===true||connection.reference.metadata.commentsAuthorized!==true)throw new DomainError('CONFIGURATION_REQUIRED',503);
 const parsed=commentReplyApprovalBindingSchema.safeParse({brandRevision:brand.revision,contentRevision:comment.contentRevision,reviewRevision:comment.revision,rootId:root.id,rootContentRevision:root.contentRevision,rootReviewRevision:root.revision,connectionId:connection.id,credentialVersion:connection.credentialVersion,channel:{provider:'youtube',internalId:connection.id,externalId:connection.reference.externalId,metadata:{}}});
 if(!parsed.success)throw new DomainError('PROVIDER_REJECTED',502);
 return {draftId:draft.id,binding:parsed.data};
}
export class CommentReplyApprovalRepository{
 constructor(private readonly db:Database){}
 async approve(userId:string,tenantId:string,brandId:string,publicationId:string,commentId:string,raw:CommentReplyApproval,correlationId:string){
  const input=commentReplyApprovalSchema.parse(raw),inputHash=createHash('sha256').update(JSON.stringify({brandId,publicationId,commentId,...input})).digest('hex');
  return this.db.transaction(async tx=>{
   await lockTenant(tx,tenantId);await authorizeComment(tx,userId,tenantId,brandId,publicationId);await assertMembership(tx,userId,tenantId,'approve');await assertManagedFeature(tx,'comments',userId,tenantId);
   const [existing]=await tx.select().from(commentReplyApprovals).where(and(eq(commentReplyApprovals.tenantId,tenantId),eq(commentReplyApprovals.idempotencyKey,input.idempotencyKey)));
   if(existing){if(existing.approvedBy!==userId||existing.inputHash!==inputHash)throw new DomainError('CONFLICT',409);return {id:existing.id,version:existing.version};}
   const target=await commentReplyApprovalBinding(tx,userId,tenantId,brandId,publicationId,commentId,input.version,input.revision);
   const [approval]=await tx.insert(commentReplyApprovals).values({tenantId,publicationId,commentId,draftId:target.draftId,version:input.version,draftRevision:input.revision,connectionId:target.binding.connectionId,binding:target.binding,approvedBy:userId,idempotencyKey:input.idempotencyKey,inputHash}).returning();
   await tx.insert(auditLogs).values({tenantId,userId,resourceId:approval!.id,action:'COMMENT_REPLY_APPROVED',correlationId,metadata:{version:input.version,risksAcknowledged:true}});
   return {id:approval!.id,version:approval!.version};
  });
 }
 async status(userId:string,tenantId:string,brandId:string,publicationId:string,commentId:string){return this.db.transaction(async tx=>{
  await lockTenant(tx,tenantId);await authorizeComment(tx,userId,tenantId,brandId,publicationId);
  const [comment]=await tx.select({id:comments.id}).from(comments).where(and(eq(comments.tenantId,tenantId),eq(comments.publicationId,publicationId),eq(comments.id,commentId)));if(!comment)throw new DomainError('NOT_FOUND',404);
  const [approval]=await tx.select().from(commentReplyApprovals).where(scope(tenantId,publicationId,commentId)).orderBy(desc(commentReplyApprovals.createdAt),desc(commentReplyApprovals.id)).limit(1);
  if(!approval)return null;
  const summary={id:approval.id,version:approval.version,createdAt:approval.createdAt};
  const [revoked]=await tx.select({id:commentReplyApprovalRevocations.id}).from(commentReplyApprovalRevocations).where(and(eq(commentReplyApprovalRevocations.tenantId,tenantId),eq(commentReplyApprovalRevocations.approvalId,approval.id)));
  if(revoked)return {...summary,status:'REVOKED' as const};
  try{const current=await commentReplyApprovalBinding(tx,approval.approvedBy,tenantId,brandId,publicationId,commentId,approval.version,approval.draftRevision);if(current.draftId!==approval.draftId||JSON.stringify(current.binding)!==JSON.stringify(commentReplyApprovalBindingSchema.parse(approval.binding)))return {...summary,status:'STALE' as const};}
  catch(error){if(!(error instanceof DomainError))throw error;return {...summary,status:'STALE' as const};}
  return {...summary,status:'APPROVED' as const};
 });}
 async revoke(userId:string,tenantId:string,brandId:string,publicationId:string,commentId:string,approvalId:string,correlationId:string){return this.db.transaction(async tx=>{
  await lockTenant(tx,tenantId);await authorizeComment(tx,userId,tenantId,brandId,publicationId);await assertMembership(tx,userId,tenantId,'approve');
  const [approval]=await tx.select().from(commentReplyApprovals).where(and(scope(tenantId,publicationId,commentId),eq(commentReplyApprovals.id,approvalId)));if(!approval)throw new DomainError('NOT_FOUND',404);
  const inserted=await tx.insert(commentReplyApprovalRevocations).values({tenantId,approvalId,revokedBy:userId}).onConflictDoNothing().returning();
  if(inserted.length)await tx.insert(auditLogs).values({tenantId,userId,resourceId:approvalId,action:'COMMENT_REPLY_APPROVAL_REVOKED',correlationId});
  return {id:approvalId,status:'REVOKED' as const};
 });}
}
