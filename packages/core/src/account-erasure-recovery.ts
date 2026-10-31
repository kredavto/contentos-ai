import {z} from 'zod';
import type {AccountErasureRecoveryRepository} from '@contentos/db';
import {DomainError,accountErasureRecoverySchema} from '@contentos/types';
export class AccountErasureRecoveryService{
 constructor(private readonly repository:Pick<AccountErasureRecoveryRepository,'retry'>,private readonly enabled:boolean){}
 retry(actorId:string,id:string,raw:unknown,correlationId:string){
  for(const value of [actorId,id,correlationId])z.uuid().parse(value);
  const input=accountErasureRecoverySchema.parse(raw);if(!this.enabled)throw new DomainError('CONFIGURATION_REQUIRED',503);
  return this.repository.retry(actorId,id,input,correlationId);
 }
}
