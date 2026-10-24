import {z} from 'zod';
import type {CommentImportRepository,CommentImportPageRepository} from '@contentos/db';
import {DomainError,type YouTubeCommentsProvider,type ErrorReporter} from '@contentos/types';
import type {YouTubeService} from './youtube';
import {advanceCommentThreads,advanceCommentReplies} from './comment-import-position';
import {reportError} from './error-reporting';

/** One bounded read-only provider page per lease; the database owns retry and pagination. */
export class CommentImportProcessor{
 constructor(
  private readonly repository:Pick<CommentImportRepository,'claim'|'preparePage'|'fail'>,
  private readonly pages:Pick<CommentImportPageRepository,'complete'>,
  private readonly access:Pick<YouTubeService,'accessForComments'>,
  private readonly provider:YouTubeCommentsProvider|null,
  private readonly errors?:ErrorReporter,
 ){}
 async run(tenantId:string,id:string){
  z.uuid().parse(tenantId);z.uuid().parse(id);
  const job=await this.repository.claim(tenantId,id);if(!job)return;
  try{
   if(!this.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
   const context={tenantId,internalId:job.id,idempotencyKey:job.id,correlationId:job.correlationId,signal:AbortSignal.timeout(75000)};
   const authorize=async()=>{
    const grant=await this.access.accessForComments(job.requestedBy,tenantId,job.brandId,job.connectionId,job.credentialVersion,context);
    if(grant.channelId!==job.channelId)throw new DomainError('NOT_AUTHORIZED',403);
    context.signal.throwIfAborted();return grant;
   };
   await this.repository.preparePage(job);
   const grant=await authorize(),target=await this.repository.preparePage(job);
   context.signal.throwIfAborted();
   const page=target.position.kind==='THREADS'
    ?await this.provider.commentThreads(grant.accessToken,target.externalId,target.channelId,target.position.cursor,context)
    :await this.provider.commentReplies(grant.accessToken,target.externalId,target.channelId,target.position.cursor,context);
   // Recheck encrypted scopes after the remote read, including refresh/downscope races.
   await authorize();context.signal.throwIfAborted();
   await this.pages.complete(job,page,(position,nextCursor,parentIds)=>position.kind==='THREADS'
    ?advanceCommentThreads(position,{nextCursor,parentIds}):advanceCommentReplies(position,{nextCursor}));
  }catch(error){
   const safe=error instanceof DomainError?error:new DomainError('PROVIDER_UNAVAILABLE',503);
   reportError(this.errors,safe,{correlationId:job.correlationId,jobId:id});await this.repository.fail(job,safe.code);
  }
 }
}
