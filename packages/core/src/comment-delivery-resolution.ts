import {z} from 'zod';
import type {CommentDeliveryRepository} from '@contentos/db';
import {DomainError,youtubeCommentIdSchema,type YouTubeCommentPublishingProvider} from '@contentos/types';
import type {YouTubeService} from './youtube';
const inputSchema=z.object({tenantId:z.uuid(),deliveryId:z.uuid(),attemptId:z.uuid(),externalCommentId:youtubeCommentIdSchema,ticket:z.string().trim().min(5).max(200),confirmAttemptEvidence:z.literal(true)}).strict();
/** Operator-provided receipt identity plus read-only verification; never sends or retries a reply. */
export class CommentDeliveryResolutionService{
 constructor(private readonly repository:Pick<CommentDeliveryRepository,'prepareResolution'|'completeResolution'>,private readonly access:Pick<YouTubeService,'accessForComments'>,private readonly provider:YouTubeCommentPublishingProvider|null,private readonly enabled:boolean){}
 async resolve(actorId:string,raw:unknown,correlationId:string){
  z.uuid().parse(actorId);z.uuid().parse(correlationId);const input=inputSchema.parse(raw);
  if(!this.enabled||!this.provider)throw new DomainError('CONFIGURATION_REQUIRED',503);
  const prepared=await this.repository.prepareResolution(actorId,input.tenantId,input.deliveryId,input.attemptId,input.externalCommentId,input.ticket,correlationId);
  if(prepared.completed)return {id:prepared.job.id,status:prepared.job.status};
  const context={tenantId:input.tenantId,internalId:input.deliveryId,idempotencyKey:input.attemptId,correlationId,signal:AbortSignal.timeout(45000)},target=prepared.target;
  const grant=await this.access.accessForComments(prepared.job.requestedBy,input.tenantId,prepared.brandId,target.connectionId,target.credentialVersion,context);
  if(grant.channelId!==target.input.channelId)throw new DomainError('NOT_AUTHORIZED',403);
  const receipt=await this.provider.commentReplyReceipt(grant.accessToken,input.externalCommentId,target.input,context);
  context.signal.throwIfAborted();
  if(!receipt||receipt.reference.provider!=='youtube'||receipt.reference.internalId!==input.deliveryId||receipt.reference.externalId!==input.externalCommentId||receipt.reference.metadata.channelId!==target.input.channelId||receipt.reference.metadata.parentId!==target.input.parentId)throw new DomainError('RECONCILIATION_REQUIRED',409);
  return this.repository.completeResolution(actorId,input.tenantId,input.deliveryId,input.attemptId,input.externalCommentId,new Date(receipt.publishedAt),input.ticket,correlationId);
 }
}
