import {assertManagedFeature} from './feature-policy';
import {and,desc,eq,lt,sql} from 'drizzle-orm';
import {DomainError,commentReplyInputSchema,commentReplyEditSchema,type CommentReplyInput,type CommentReplyEdit} from '@contentos/types';
import type {Database} from '../index';
import {comments,brands,jobs,commentReplyDrafts,commentReplyVersions,auditLogs} from '../schema';
import {authorizeComment} from './comments';
import {lockTenant} from './ledger';
const scope=(tenantId:string,publicationId:string,commentId:string)=>and(eq(comments.tenantId,tenantId),eq(comments.publicationId,publicationId),eq(comments.id,commentId));
const draftScope=(tenantId:string,publicationId:string,commentId:string)=>and(eq(commentReplyDrafts.tenantId,tenantId),eq(commentReplyDrafts.publicationId,publicationId),eq(commentReplyDrafts.commentId,commentId));
export class CommentReplyRepository{
 constructor(private readonly db:Database){}
 async generationStatus(userId:string,tenantId:string,brandId:string,publicationId:string,commentId:string){return this.db.transaction(async tx=>{
  await authorizeComment(tx,userId,tenantId,brandId,publicationId);
  const [comment]=await tx.select({id:comments.id}).from(comments).where(scope(tenantId,publicationId,commentId));if(!comment)throw new DomainError('NOT_FOUND',404);
  const [job]=await tx.select({id:jobs.id,status:jobs.status,result:jobs.result}).from(jobs).where(and(eq(jobs.tenantId,tenantId),eq(jobs.brandId,brandId),eq(jobs.type,'DRAFT_COMMENT_REPLY'),sql`${jobs.input}->'options'->'commentReply'->>'publicationId' = ${publicationId}`,sql`${jobs.input}->'options'->'commentReply'->>'commentId' = ${commentId}`)).orderBy(desc(jobs.createdAt),desc(jobs.id)).limit(1);
  return {job:job??null};
 });}
 async history(userId:string,tenantId:string,brandId:string,publicationId:string,commentId:string,beforeVersion?:number){return this.db.transaction(async tx=>{
  await authorizeComment(tx,userId,tenantId,brandId,publicationId);
  const [comment]=await tx.select().from(comments).where(scope(tenantId,publicationId,commentId));if(!comment)throw new DomainError('NOT_FOUND',404);
  const [draft]=await tx.select().from(commentReplyDrafts).where(draftScope(tenantId,publicationId,commentId));
  if(!draft)return {draft:null,items:[],next:null};
  const rows=await tx.select().from(commentReplyVersions).where(and(eq(commentReplyVersions.tenantId,tenantId),eq(commentReplyVersions.publicationId,publicationId),eq(commentReplyVersions.commentId,commentId),eq(commentReplyVersions.draftId,draft.id),beforeVersion===undefined?undefined:lt(commentReplyVersions.version,beforeVersion))).orderBy(desc(commentReplyVersions.version)).limit(21);
  const items=rows.slice(0,20).map(row=>({id:row.id,version:row.version,source:row.source,content:row.content,createdAt:row.createdAt,sourceContentRevision:row.input.comment.contentRevision,sourceReviewRevision:row.input.comment.reviewRevision,brandRevision:row.input.brandRevision,stale:row.input.comment.contentRevision!==comment.contentRevision||row.input.comment.reviewRevision!==comment.revision}));
  return {draft:{id:draft.id,revision:draft.revision,currentVersion:draft.currentVersion},items,next:rows.length>20?{beforeVersion:items.at(-1)!.version}:null};
 });}
 async save(userId:string,tenantId:string,brandId:string,publicationId:string,commentId:string,raw:CommentReplyEdit,brain:Pick<CommentReplyInput,'brain'|'brandRevision'>,correlationId:string){
  const input=commentReplyEditSchema.parse(raw);
  return this.db.transaction(async tx=>{
   await lockTenant(tx,tenantId);await authorizeComment(tx,userId,tenantId,brandId,publicationId,true);await assertManagedFeature(tx,'comments',userId,tenantId);
   const [brand]=await tx.select().from(brands).where(and(eq(brands.tenantId,tenantId),eq(brands.id,brandId))).for('share');
   if(!brand||brand.revision!==brain.brandRevision)throw new DomainError('CONFLICT',409);
   const [comment]=await tx.select().from(comments).where(scope(tenantId,publicationId,commentId)).for('update');if(!comment)throw new DomainError('NOT_FOUND',404);
   if(comment.contentRevision!==input.contentRevision||comment.revision!==input.reviewRevision)throw new DomainError('CONFLICT',409);
   const [current]=await tx.select().from(commentReplyDrafts).where(draftScope(tenantId,publicationId,commentId)).for('update');
   if(current?current.revision!==input.revision:input.revision!==null)throw new DomainError('CONFLICT',409);
   let parentText:string|null=null;
   if(comment.parentId){const [parent]=await tx.select().from(comments).where(scope(tenantId,publicationId,comment.parentId)).for('share');if(!parent)throw new DomainError('CONFLICT',409);parentText=parent.text;}
   const snapshot=commentReplyInputSchema.parse({...brain,comment:{id:commentId,contentRevision:comment.contentRevision,reviewRevision:comment.revision,text:comment.text,parentText}});
   const version=current?current.currentVersion+1:1,revision=current?current.revision+1:0;
   const draft=current??(await tx.insert(commentReplyDrafts).values({tenantId,publicationId,commentId}).returning())[0]!;
   // Manual editing cannot certify model safety or approve external delivery.
   const content={reply:input.reply,sentiment:null,risks:[{category:'UNCERTAIN' as const,source:'CONTEXT' as const,quote:null,reason:'Ручной черновик требует проверки человеком перед отправкой.'}]};
   await tx.insert(commentReplyVersions).values({tenantId,publicationId,commentId,draftId:draft.id,version,source:'HUMAN',input:snapshot,content,createdBy:userId});
   if(current)await tx.update(commentReplyDrafts).set({currentVersion:version,revision,updatedAt:new Date()}).where(draftScope(tenantId,publicationId,commentId));
   await tx.insert(auditLogs).values({tenantId,userId,resourceId:draft.id,action:'COMMENT_REPLY_DRAFT_SAVED',correlationId,metadata:{version,revision,source:'HUMAN'}});
   return {id:draft.id,currentVersion:version,revision};
  });
 }
}
