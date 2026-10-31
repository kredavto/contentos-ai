import {z} from 'zod';
import {CommentRepository} from '@contentos/db';
import {commentListSchema,commentTriageSchema} from '@contentos/types';
const uuid=z.uuid();
export class CommentService{
 constructor(private readonly repository:CommentRepository){}
 list(userId:string,tenantId:string,brandId:string,publicationId:string,raw:unknown){
  return this.repository.list(uuid.parse(userId),uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(publicationId),commentListSchema.parse(raw));
 }
 triage(userId:string,tenantId:string,brandId:string,publicationId:string,id:string,raw:unknown,correlationId:string){
  return this.repository.triage(uuid.parse(userId),uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(publicationId),uuid.parse(id),commentTriageSchema.parse(raw),uuid.parse(correlationId));
 }
}
