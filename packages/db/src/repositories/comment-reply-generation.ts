import {and,eq} from 'drizzle-orm';
import {DomainError,commentReplyTargetSchema,commentReplyInputSchema,validateCommentReply,type CommentReplyTarget,type CommentReplySnapshot,type GenerationInput} from '@contentos/types';
import {comments,commentReplyDrafts,commentReplyVersions} from '../schema';
import type {Transaction} from './ledger';
import {authorizeComment} from './comments';
import type {StoredJob} from './jobs';
/** Caller holds the tenant lock for snapshot and completion. */
export async function snapshotCommentReply(tx:Transaction,userId:string,tenantId:string,brandId:string,raw:CommentReplyTarget):Promise<CommentReplySnapshot>{
 const target=commentReplyTargetSchema.parse(raw);await authorizeComment(tx,userId,tenantId,brandId,target.publicationId,true);
 const [comment]=await tx.select().from(comments).where(and(eq(comments.tenantId,tenantId),eq(comments.publicationId,target.publicationId),eq(comments.id,target.commentId))).for('update');
 if(!comment)throw new DomainError('NOT_FOUND',404);
 if(comment.contentRevision!==target.contentRevision||comment.revision!==target.reviewRevision)throw new DomainError('CONFLICT',409);
 const [draft]=await tx.select().from(commentReplyDrafts).where(and(eq(commentReplyDrafts.tenantId,tenantId),eq(commentReplyDrafts.publicationId,target.publicationId),eq(commentReplyDrafts.commentId,comment.id))).for('update');
 if((draft?.revision??null)!==target.draftRevision)throw new DomainError('CONFLICT',409);
 let parentText:string|null=null;
 if(comment.parentId){const [parent]=await tx.select().from(comments).where(and(eq(comments.tenantId,tenantId),eq(comments.publicationId,target.publicationId),eq(comments.id,comment.parentId))).for('share');if(!parent)throw new DomainError('CONFLICT',409);parentText=parent.text;}
 return {publicationId:target.publicationId,draftRevision:target.draftRevision,comment:{id:comment.id,contentRevision:comment.contentRevision,reviewRevision:comment.revision,text:comment.text,parentText}};
}
export async function checkCommentReplySnapshot(tx:Transaction,job:StoredJob,input:GenerationInput){
 if(!input.options.commentReply||!input.commentReply)throw new DomainError('INVALID_INPUT');
 const current=await snapshotCommentReply(tx,job.requestedBy,job.tenantId,job.brandId,input.options.commentReply);
 if(JSON.stringify(current)!==JSON.stringify(input.commentReply))throw new DomainError('CONFLICT',409);
 return current;
}
export async function persistGeneratedCommentReply(tx:Transaction,job:StoredJob,input:GenerationInput,raw:unknown){
 const target=await checkCommentReplySnapshot(tx,job,input);
 const snapshot=commentReplyInputSchema.parse({brain:input.brain,brandRevision:input.brandRevision,comment:target.comment});
 const result=validateCommentReply(raw,snapshot);if(!result.success)throw new DomainError('PROVIDER_REJECTED',502);
 const where=and(eq(commentReplyDrafts.tenantId,job.tenantId),eq(commentReplyDrafts.publicationId,target.publicationId),eq(commentReplyDrafts.commentId,target.comment.id));
 const [current]=await tx.select().from(commentReplyDrafts).where(where);
 const version=current?current.currentVersion+1:1;
 const draft=current??(await tx.insert(commentReplyDrafts).values({tenantId:job.tenantId,publicationId:target.publicationId,commentId:target.comment.id}).returning())[0]!;
 await tx.insert(commentReplyVersions).values({tenantId:job.tenantId,publicationId:target.publicationId,commentId:target.comment.id,draftId:draft.id,version,source:'AI',input:snapshot,content:result.data,jobId:job.id,createdBy:job.requestedBy});
 if(current)await tx.update(commentReplyDrafts).set({currentVersion:version,revision:current.revision+1,updatedAt:new Date()}).where(where);
 return {internalId:draft.id,version};
}
