import {z} from 'zod';
import {ApprovalRepository} from '@contentos/db';
import {approvalRequestSchema,approvalDecisionSchema} from '@contentos/types';
export class ApprovalService{
  constructor(private readonly repository:ApprovalRepository){}
  create(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){return this.repository.create(userId,z.uuid().parse(tenantId),z.uuid().parse(brandId),approvalRequestSchema.parse(raw),correlationId);}
  decide(userId:string,tenantId:string,id:string,raw:unknown,correlationId:string){return this.repository.decide(userId,z.uuid().parse(tenantId),z.uuid().parse(id),approvalDecisionSchema.parse(raw),correlationId);}
  list(userId:string,tenantId:string,raw:unknown){const {cursor}=z.object({cursor:z.uuid().optional()}).strict().parse(raw);return this.repository.list(userId,z.uuid().parse(tenantId),cursor);}
  reviewers(userId:string,tenantId:string){return this.repository.reviewers(userId,z.uuid().parse(tenantId));}
}
