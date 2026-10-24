import { z } from 'zod';
import { FunnelRepository } from '@contentos/db';
import { funnelCreateSchema, funnelPageSchema, funnelChoicesSchema, funnelMeasurementSchema, DomainError } from '@contentos/types';
const uuid=z.uuid();
export class FunnelService {
  constructor(private readonly repository:FunnelRepository){}
  choices(userId:string,tenantId:string,brandId:string,input:unknown){return this.repository.choices(userId,uuid.parse(tenantId),uuid.parse(brandId),funnelChoicesSchema.parse(input));}
  list(userId:string,tenantId:string,brandId:string,input:unknown){return this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId),funnelPageSchema.parse(input).before);}
  create(userId:string,tenantId:string,brandId:string,input:unknown,correlationId:string){return this.repository.create(userId,uuid.parse(tenantId),uuid.parse(brandId),funnelCreateSchema.parse(input),correlationId);}
  measurements(userId:string,tenantId:string,brandId:string,targetId:string,input:unknown){return this.repository.measurements(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(targetId),funnelPageSchema.parse(input).before);}
  measure(userId:string,tenantId:string,brandId:string,targetId:string,raw:unknown,correlationId:string){const input=funnelMeasurementSchema.parse(raw);if(Date.parse(input.to)>Date.now())throw new DomainError('INVALID_INPUT');return this.repository.measure(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(targetId),input,correlationId);}
}
