import {z} from 'zod';
import {CommentReplyRepository,BrandRepository} from '@contentos/db';
import {commentReplyEditSchema,commentReplyHistorySchema} from '@contentos/types';
const uuid=z.uuid();
export class CommentReplyService{
 constructor(private readonly repository:CommentReplyRepository,private readonly brands:BrandRepository){}
 generationStatus(userId:string,tenantId:string,brandId:string,publicationId:string,commentId:string){return this.repository.generationStatus(uuid.parse(userId),uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(publicationId),uuid.parse(commentId));}
 history(userId:string,tenantId:string,brandId:string,publicationId:string,commentId:string,raw:unknown){return this.repository.history(uuid.parse(userId),uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(publicationId),uuid.parse(commentId),commentReplyHistorySchema.parse(raw).beforeVersion);}
 async save(userId:string,tenantId:string,brandId:string,publicationId:string,commentId:string,raw:unknown,correlationId:string){
  for(const id of [userId,tenantId,brandId,publicationId,commentId,correlationId])uuid.parse(id);
  const input=commentReplyEditSchema.parse(raw),brain=await this.brands.getBrandBrain(userId,tenantId,brandId);
  return this.repository.save(userId,tenantId,brandId,publicationId,commentId,input,{brain:brain.data,brandRevision:brain.brand.revision},correlationId);
 }
}
