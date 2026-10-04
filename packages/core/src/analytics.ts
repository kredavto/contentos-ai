import {z} from 'zod';
import {AnalyticsRepository} from '@contentos/db';
import {manualMetricsSchema} from '@contentos/types';
const uuid=z.uuid();
export class AnalyticsService{
  constructor(private readonly repository:AnalyticsRepository){}
  overview(userId:string,tenantId:string,brandId:string){return this.repository.overview(userId,uuid.parse(tenantId),uuid.parse(brandId));}
  history(userId:string,tenantId:string,brandId:string,id:string){return this.repository.history(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));}
  record(userId:string,tenantId:string,brandId:string,input:unknown,correlationId:string){return this.repository.record(userId,uuid.parse(tenantId),uuid.parse(brandId),manualMetricsSchema.parse(input),correlationId);}
}
