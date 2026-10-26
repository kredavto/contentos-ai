import {z} from 'zod';
import type {CommentDeliveryRepository,CommentDelivery} from '@contentos/db';
import {DomainError,type YouTubeCommentPublishingProvider} from '@contentos/types';
import type {YouTubeService} from './youtube';
/** Non-idempotent writes have exactly one recorded dispatch attempt, never automatic retries. */
export class CommentDeliveryProcessor{
 constructor(private readonly repository:Pick<CommentDeliveryRepository,'lookup'|'prepare'|'attempt'|'finish'>,private readonly access:Pick<YouTubeService,'accessForComments'>,private readonly provider:YouTubeCommentPublishingProvider|null){}
 async run(tenantId:string,id:string){
  z.uuid().parse(tenantId);z.uuid().parse(id);
  const stored=await this.repository.lookup(tenantId,id);if(!stored)return;
  let attempted:CommentDelivery|null=null;
  try{
   const prepared=await this.repository.prepare(tenantId,id,stored.brandId);if(!prepared)return;
   if(!this.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
   const context={tenantId,internalId:id,idempotencyKey:id,correlationId:stored.job.correlationId,signal:AbortSignal.timeout(75000)},target=prepared.target;
   const grant=await this.access.accessForComments(stored.job.requestedBy,tenantId,stored.brandId,target.connectionId,target.credentialVersion,context);
   if(grant.channelId!==target.input.channelId)throw new DomainError('NOT_AUTHORIZED',403);
   context.signal.throwIfAborted();
   // Refresh/scopes checks occur first; this transaction rechecks approval and sender authority.
   const claimed=await this.repository.attempt(tenantId,id,stored.brandId);if(!claimed)return;
   attempted=claimed.job;
   const receipt=await this.provider.insertCommentReply(grant.accessToken,claimed.target.input,context);
   const reference=receipt.reference;
   if(reference.provider!=='youtube'||reference.internalId!==id||reference.metadata.parentId!==claimed.target.input.parentId||reference.metadata.channelId!==claimed.target.input.channelId||!reference.externalId||!Number.isFinite(Date.parse(receipt.publishedAt)))throw new DomainError('RECONCILIATION_REQUIRED',409);
   await this.repository.finish(attempted,{status:'SUCCEEDED',externalId:reference.externalId,publishedAt:new Date(receipt.publishedAt)});
  }catch(error){
   const code=error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE';
   // Only an explicit provider guarantee can make a post-dispatch rejection definitive.
   const definitive=error instanceof DomainError&&'definitiveRejection' in error&&error.definitiveRejection===true;
   await this.repository.finish(attempted??stored.job,{status:attempted&&!definitive?'RECONCILIATION_REQUIRED':'REJECTED',code});
  }
 }
}
