import {avatarConsentPolicies} from './avatars';
import {z} from 'zod';
import {ApprovalRepository} from '@contentos/db';
import {DomainError,type StorageProvider,approvalRequestSchema,approvalDecisionSchema} from '@contentos/types';
export class ApprovalService{
  constructor(private readonly repository:ApprovalRepository,private readonly storage:StorageProvider|null=null){}
  create(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){return this.repository.create(userId,z.uuid().parse(tenantId),z.uuid().parse(brandId),approvalRequestSchema.parse(raw),correlationId,avatarConsentPolicies());}
  decide(userId:string,tenantId:string,id:string,raw:unknown,correlationId:string){return this.repository.decide(userId,z.uuid().parse(tenantId),z.uuid().parse(id),approvalDecisionSchema.parse(raw),correlationId,avatarConsentPolicies());}
  list(userId:string,tenantId:string,raw:unknown){const {cursor}=z.object({cursor:z.uuid().optional()}).strict().parse(raw);return this.repository.list(userId,z.uuid().parse(tenantId),cursor);}
  async preview(userId:string,tenantId:string,id:string,correlationId:string){
    z.uuid().parse(tenantId);z.uuid().parse(id);const row=await this.repository.preview(userId,tenantId,id,avatarConsentPolicies());
    if(!this.storage)throw new DomainError('CONFIGURATION_REQUIRED',503);
    const url=await this.storage.signedDownload(row.storageKey,60,{internalId:row.id,tenantId,idempotencyKey:id,correlationId,signal:AbortSignal.timeout(15_000)});
    const coverUrl=row.kind==='VIDEO'?await this.storage.signedDownload(row.coverKey,60,{internalId:row.id,tenantId,idempotencyKey:id,correlationId,signal:AbortSignal.timeout(15_000)}):null;
    const current=await this.repository.preview(userId,tenantId,id,avatarConsentPolicies());
    if(current.storageKey!==row.storageKey||current.sha256!==row.sha256||current.coverKey!==row.coverKey||current.coverRevision!==row.coverRevision)throw new DomainError('CONFLICT',409);
    return row.kind==='VIDEO'?{videoUrl:url,coverUrl:coverUrl!,expiresInSeconds:60}:{url,expiresInSeconds:60};
  }
  reviewers(userId:string,tenantId:string){return this.repository.reviewers(userId,z.uuid().parse(tenantId));}
}
