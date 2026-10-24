import { z } from 'zod';
import { NotificationPreferencesRepository } from '@contentos/db';
import { notificationPreferencesSchema } from '@contentos/types';
export class NotificationPreferencesService {
  constructor(private readonly repository:NotificationPreferencesRepository,private readonly deliveryConfigured=false){}
  async get(userId:string,tenantId:string){return {...await this.repository.get(userId,z.uuid().parse(tenantId)),deliveryStatus:this.deliveryConfigured?'READY':'CONFIGURATION_REQUIRED'};}
  update(userId:string,tenantId:string,raw:unknown,correlationId:string){return this.repository.update(userId,z.uuid().parse(tenantId),notificationPreferencesSchema.parse(raw),z.uuid().parse(correlationId));}
}
