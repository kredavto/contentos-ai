import {z} from 'zod';
import {CalendarRepository} from '@contentos/db';
import {calendarCreateSchema,calendarUpdateSchema,calendarCancelSchema,calendarWindowSchema} from '@contentos/types';
import {avatarConsentPolicies} from './avatars';
const uuid=z.uuid();
export class CalendarService{
  constructor(private readonly repository:CalendarRepository){}
  list(userId:string,tenantId:string,brandId:string,input:unknown){const window=calendarWindowSchema.parse(input);return this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId),new Date(window.from),new Date(window.to));}
  create(userId:string,tenantId:string,brandId:string,input:unknown,correlationId:string){return this.repository.create(userId,uuid.parse(tenantId),uuid.parse(brandId),calendarCreateSchema.parse(input),avatarConsentPolicies(),correlationId);}
  update(userId:string,tenantId:string,brandId:string,id:string,input:unknown,correlationId:string){return this.repository.update(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),calendarUpdateSchema.parse(input),avatarConsentPolicies(),correlationId);}
  cancel(userId:string,tenantId:string,brandId:string,id:string,input:unknown,correlationId:string){return this.repository.cancel(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),calendarCancelSchema.parse(input).revision,correlationId);}
}
