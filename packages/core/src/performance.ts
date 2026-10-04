import {z} from 'zod';
import {PerformanceRepository} from '@contentos/db';
import {DomainError,recommendationDecisionSchema} from '@contentos/types';
const uuid=z.uuid();
export class PerformanceService{
  constructor(private readonly repository:PerformanceRepository,private readonly enabled:boolean){}
  list(userId:string,tenantId:string,brandId:string){return this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId));}
  decide(userId:string,tenantId:string,brandId:string,raw:unknown,correlationId:string){
    if(!this.enabled)throw new DomainError('CONFIGURATION_REQUIRED',503);
    return this.repository.decide(userId,uuid.parse(tenantId),uuid.parse(brandId),recommendationDecisionSchema.parse(raw),correlationId);
  }
}
