import {z} from 'zod';
import {CommentImportRepository} from '@contentos/db';
import {DomainError,commentImportRequestSchema,commentImportRevisionSchema} from '@contentos/types';
const uuid=z.uuid();
export class CommentImportService{
 constructor(private readonly repository:CommentImportRepository,private readonly configured:boolean){}
 async latest(userId:string,tenantId:string,brandId:string,publicationId:string){
  const job=await this.repository.latest(uuid.parse(userId),uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(publicationId));
  return {job,configuration:{ready:this.configured,status:this.configured?'CONFIGURED' as const:'CONFIGURATION_REQUIRED' as const}};
 }
 request(userId:string,tenantId:string,brandId:string,publicationId:string,raw:unknown,correlationId:string){
  uuid.parse(userId);uuid.parse(tenantId);uuid.parse(brandId);uuid.parse(publicationId);uuid.parse(correlationId);const input=commentImportRequestSchema.parse(raw);
  if(!this.configured)throw new DomainError('CONFIGURATION_REQUIRED',503);
  return this.repository.request(userId,tenantId,brandId,publicationId,input.idempotencyKey,correlationId);
 }
 resume(userId:string,tenantId:string,brandId:string,publicationId:string,id:string,raw:unknown){
  uuid.parse(userId);uuid.parse(tenantId);uuid.parse(brandId);uuid.parse(publicationId);uuid.parse(id);const input=commentImportRevisionSchema.parse(raw);
  if(!this.configured)throw new DomainError('CONFIGURATION_REQUIRED',503);
  return this.repository.resume(userId,tenantId,brandId,publicationId,id,input.revision);
 }
 cancel(userId:string,tenantId:string,brandId:string,publicationId:string,id:string,raw:unknown){
  return this.repository.cancel(uuid.parse(userId),uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(publicationId),uuid.parse(id),commentImportRevisionSchema.parse(raw).revision);
 }
}
