import {and,desc,eq,isNull,lt,or,sql} from 'drizzle-orm';
import {DomainError,type CommentListInput,type CommentTriageInput} from '@contentos/types';
import type {Database} from '../index';
import {comments,publications,publishingJobs,auditLogs} from '../schema';
import {authorizeSocial} from './social';
import {lockTenant,type Transaction} from './ledger';
const publicationWhere=(tenantId:string,publicationId:string)=>and(eq(comments.tenantId,tenantId),eq(comments.publicationId,publicationId));
export async function authorizeComment(tx:Transaction,userId:string,tenantId:string,brandId:string,publicationId:string,manage=false){
 await authorizeSocial(tx,userId,tenantId,brandId,manage);
 const [publication]=await tx.select({id:publications.id}).from(publications).innerJoin(publishingJobs,and(eq(publishingJobs.tenantId,publications.tenantId),eq(publishingJobs.id,publications.jobId))).where(and(eq(publications.tenantId,tenantId),eq(publications.id,publicationId),eq(publishingJobs.brandId,brandId),eq(publications.provider,'youtube'),eq(publishingJobs.provider,'youtube')));
 if(!publication)throw new DomainError('NOT_FOUND',404);
}
const projection={id:comments.id,publicationId:comments.publicationId,parentId:comments.parentId,provider:comments.provider,authorName:comments.authorName,text:comments.text,providerCreatedAt:comments.providerCreatedAt,providerUpdatedAt:comments.providerUpdatedAt,lastObservedAt:comments.lastObservedAt,replyCount:comments.replyCount,canReply:comments.canReply,isPublic:comments.isPublic,sentiment:comments.sentiment,status:comments.status,revision:comments.revision,contentRevision:comments.contentRevision};
export class CommentRepository{
 constructor(private readonly db:Database){}
 async list(userId:string,tenantId:string,brandId:string,publicationId:string,input:CommentListInput){
  return this.db.transaction(async tx=>{
   await authorizeComment(tx,userId,tenantId,brandId,publicationId);
   if(input.parentId){
    const [parent]=await tx.select({id:comments.id}).from(comments).where(and(publicationWhere(tenantId,publicationId),eq(comments.id,input.parentId),isNull(comments.parentId)));
    if(!parent)throw new DomainError('NOT_FOUND',404);
   }
   const cursor=input.afterCreatedAt&&input.afterId?or(lt(comments.providerCreatedAt,new Date(input.afterCreatedAt)),and(eq(comments.providerCreatedAt,new Date(input.afterCreatedAt)),lt(comments.id,input.afterId))):undefined;
   const rows=await tx.select(projection).from(comments).where(and(publicationWhere(tenantId,publicationId),input.parentId?eq(comments.parentId,input.parentId):isNull(comments.parentId),input.status?eq(comments.status,input.status):undefined,cursor)).orderBy(desc(comments.providerCreatedAt),desc(comments.id)).limit(26);
   const items=rows.slice(0,25),last=items.at(-1);
   return {items,next:rows.length>25&&last?{afterCreatedAt:last.providerCreatedAt.toISOString(),afterId:last.id}:null};
  });
 }
 async triage(userId:string,tenantId:string,brandId:string,publicationId:string,id:string,input:CommentTriageInput,correlationId:string){
  return this.db.transaction(async tx=>{
   await lockTenant(tx,tenantId);await authorizeComment(tx,userId,tenantId,brandId,publicationId,true);
   const condition=and(publicationWhere(tenantId,publicationId),eq(comments.id,id));
   const [current]=await tx.select().from(comments).where(condition).for('update');
   if(!current)throw new DomainError('NOT_FOUND',404);
   if(current.revision!==input.revision||current.contentRevision!==input.contentRevision)throw new DomainError('CONFLICT',409);
   if(current.status===input.status)return {id,status:current.status,revision:current.revision,contentRevision:current.contentRevision};
   const [updated]=await tx.update(comments).set({status:input.status,revision:current.revision+1,updatedAt:sql`clock_timestamp()`}).where(condition).returning({id:comments.id,status:comments.status,revision:comments.revision,contentRevision:comments.contentRevision});
   await tx.insert(auditLogs).values({tenantId,userId,resourceId:id,action:'COMMENT_TRIAGED',correlationId,metadata:{previousStatus:current.status,status:input.status,revision:current.revision+1,contentRevision:current.contentRevision}});
   return updated!;
  });
 }
}
