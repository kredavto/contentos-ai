import {z} from 'zod';
import {DomainError} from '@contentos/types';
import type {CommentDeliveryRepository} from '@contentos/db';
const inputSchema=z.object({approvalId:z.uuid(),idempotencyKey:z.uuid(),confirmSend:z.literal(true)}).strict();
export class CommentDeliveryService{
 constructor(private readonly repository:Pick<CommentDeliveryRepository,'latest'|'request'>,private readonly configured:boolean){}
 async latest(actorId:string,tenantId:string,brandId:string,publicationId:string,commentId:string){
  for(const id of [actorId,tenantId,brandId,publicationId,commentId])z.uuid().parse(id);
  const job=await this.repository.latest(actorId,tenantId,brandId,publicationId,commentId);
  return {job,configuration:{ready:this.configured}};
 }
 request(actorId:string,tenantId:string,brandId:string,publicationId:string,commentId:string,raw:unknown,correlationId:string){
  for(const id of [actorId,tenantId,brandId,publicationId,commentId,correlationId])z.uuid().parse(id);
  const input=inputSchema.parse(raw);if(!this.configured)throw new DomainError('CONFIGURATION_REQUIRED',503);
  return this.repository.request(actorId,tenantId,brandId,input.approvalId,input.idempotencyKey,correlationId,{publicationId,commentId});
 }
}
