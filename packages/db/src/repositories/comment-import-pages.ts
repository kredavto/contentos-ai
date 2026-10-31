import {createHash} from 'node:crypto';
import {and,eq,isNull} from 'drizzle-orm';
import {DomainError,commentImportPositionSchema,importedThreadPageSchema,importedReplyPageSchema,type ImportedComment,type CommentImportPosition} from '@contentos/types';
import type {Database} from '../index';
import {comments,commentImports,commentImportPages,auditLogs} from '../schema';
import {lockTenant,type Transaction} from './ledger';
import {ownedCommentImport,permittedCommentImport,commentImportWhere,type CommentImportJob} from './comment-imports';
type Planner=(position:CommentImportPosition,nextCursor:string|null,parentIds:string[])=>CommentImportPosition|null;
const marker=(position:CommentImportPosition)=>({scope:position.kind==='THREADS'?'THREADS':position.parentId,cursorHash:createHash('sha256').update(JSON.stringify(position.cursor)).digest('hex')});
async function seen(tx:Transaction,job:CommentImportJob,position:CommentImportPosition){
 const identity=marker(position);const [receipt]=await tx.select({id:commentImportPages.id}).from(commentImportPages).where(and(eq(commentImportPages.tenantId,job.tenantId),eq(commentImportPages.importId,job.id),eq(commentImportPages.scope,identity.scope),eq(commentImportPages.cursorHash,identity.cursorHash))).limit(1);return !!receipt;
}
/** Called only inside the lease-owned, authorized page transaction below. */
async function upsert(tx:Transaction,job:CommentImportJob,input:ImportedComment,externalThreadId:string,parentId:string|null,observedAt:Date,now:Date,thread:{replyCount:number;canReply:boolean;isPublic:boolean}|null){
 const condition=and(eq(comments.tenantId,job.tenantId),eq(comments.publicationId,job.publicationId),eq(comments.provider,'youtube'),eq(comments.externalCommentId,input.externalId));
 const [old]=await tx.select().from(comments).where(condition).for('update');
 const providerCreatedAt=new Date(input.publishedAt),providerUpdatedAt=new Date(input.updatedAt);
 const details={replyCount:thread?.replyCount??null,canReply:thread?.canReply??null,isPublic:thread?.isPublic??null};
 if(!old){const [row]=await tx.insert(comments).values({tenantId:job.tenantId,publicationId:job.publicationId,provider:'youtube',externalCommentId:input.externalId,externalThreadId,parentId,externalAuthorId:input.authorExternalId,authorName:input.authorName,text:input.text,providerCreatedAt,providerUpdatedAt,firstObservedAt:observedAt,lastObservedAt:observedAt,...details,createdAt:now,updatedAt:now}).returning({id:comments.id});return row!.id;}
 if(old.parentId!==parentId||old.externalThreadId!==externalThreadId||old.providerCreatedAt.getTime()!==providerCreatedAt.getTime()||observedAt<old.lastObservedAt)throw new DomainError('PROVIDER_REJECTED',502);
 const currentContent=providerUpdatedAt>=old.providerUpdatedAt;
 const changed=currentContent&&(old.text!==input.text||old.authorName!==input.authorName||old.externalAuthorId!==input.authorExternalId||old.providerUpdatedAt.getTime()!==providerUpdatedAt.getTime());
 await tx.update(comments).set({...details,lastObservedAt:observedAt,updatedAt:now,...(currentContent?{text:input.text,authorName:input.authorName,externalAuthorId:input.authorExternalId,providerUpdatedAt,contentRevision:old.contentRevision+(changed?1:0)}:{})}).where(condition);
 return old.id;
}
export class CommentImportPageRepository{
 constructor(private readonly db:Database,private readonly now=()=>new Date()){}
 /** Planner is trusted synchronous domain code, never request-supplied data. */
 async complete(job:CommentImportJob,raw:unknown,plan:Planner){
  const initial=commentImportPositionSchema.safeParse(job.position);if(!initial.success)throw new DomainError('PROVIDER_REJECTED',502);
  const parsed=initial.data.kind==='THREADS'?importedThreadPageSchema.safeParse(raw):importedReplyPageSchema.safeParse(raw);
  if(!parsed.success)throw new DomainError('PROVIDER_REJECTED',502);
  const observedAt=new Date(parsed.data.observedAt);
  return this.db.transaction(async tx=>{
   await lockTenant(tx,job.tenantId);const now=this.now(),current=await ownedCommentImport(tx,job,now);await permittedCommentImport(tx,current);
   const position=commentImportPositionSchema.parse(current.position);
   if(current.revision!==job.revision||JSON.stringify(position)!==JSON.stringify(initial.data)||!current.startedAt||observedAt<current.startedAt||observedAt.getTime()>now.getTime()+5000)throw new DomainError('CONFLICT',409);
   if(parsed.data.reference.internalId!==current.id||parsed.data.reference.metadata.channelId!==current.channelId||await seen(tx,current,position))throw new DomainError('PROVIDER_REJECTED',502);
   const parentIds:string[]=[];
   if(position.kind==='THREADS'){
    const page=importedThreadPageSchema.parse(parsed.data);if(page.reference.externalId!==current.videoId)throw new DomainError('PROVIDER_REJECTED',502);
    for(const row of page.items){
     const id=await upsert(tx,current,row.comment,row.externalId,null,observedAt,now,row);
     if(row.replyCount>0&&!await seen(tx,current,{kind:'REPLIES',parentId:id,cursor:null,pendingParentIds:[],nextThreadCursor:null}))parentIds.push(id);
    }
   }else{
    const page=importedReplyPageSchema.parse(parsed.data);
    const [parent]=await tx.select().from(comments).where(and(eq(comments.tenantId,current.tenantId),eq(comments.publicationId,current.publicationId),eq(comments.id,position.parentId),isNull(comments.parentId))).for('update');
    if(!parent||page.reference.externalId!==parent.externalCommentId)throw new DomainError('PROVIDER_REJECTED',502);
    for(const row of page.items)await upsert(tx,current,row,parent.externalThreadId,parent.id,observedAt,now,null);
   }
   const next=plan(position,parsed.data.nextCursor,parentIds),checked=next===null?null:commentImportPositionSchema.parse(next);
   await tx.insert(commentImportPages).values({tenantId:current.tenantId,importId:current.id,...marker(position),ordinal:current.completedPages+1,observedAt,createdAt:now});
   if(checked&&await seen(tx,current,checked))throw new DomainError('PROVIDER_REJECTED',502);
   const remainingPages=current.remainingPages-1,status=checked===null?'SUCCEEDED':remainingPages===0?'PARTIAL':'QUEUED';
   await tx.update(commentImports).set({status,position:checked,remainingPages,completedPages:current.completedPages+1,revision:current.revision+1,attempt:0,errorCode:null,leaseToken:null,leaseExpiresAt:null,nextAttemptAt:now,dispatchAfter:now,updatedAt:now,finishedAt:status==='SUCCEEDED'?now:null}).where(commentImportWhere(current.tenantId,current.id));
   await tx.insert(auditLogs).values({tenantId:current.tenantId,userId:current.requestedBy,resourceId:current.id,action:'COMMENT_IMPORT_PAGE_SAVED',correlationId:current.correlationId,metadata:{kind:position.kind,items:parsed.data.items.length,completedPages:current.completedPages+1,status}});
   return {status,completedPages:current.completedPages+1};
  });
 }
}
