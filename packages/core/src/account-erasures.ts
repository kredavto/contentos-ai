import {z} from 'zod';
import type {AccountErasureRepository,PrivacyRepository} from '@contentos/db';
import {DomainError,executeAccountErasureSchema,type ErrorReporter} from '@contentos/types';
import {verifyPassword} from './password';
import {reportError} from './error-reporting';
export class AccountErasureService{
 constructor(private readonly repository:Pick<AccountErasureRepository,'eligibility'|'request'>,private readonly privacy:Pick<PrivacyRepository,'passwordProof'>,private readonly enabled:boolean){}
 async eligibility(userId:string){z.uuid().parse(userId);return {...await this.repository.eligibility(userId),available:this.enabled};}
 async request(userId:string,raw:unknown,correlationId:string){
  z.uuid().parse(userId);z.uuid().parse(correlationId);const input=executeAccountErasureSchema.parse(raw);if(!this.enabled)throw new DomainError('CONFIGURATION_REQUIRED',503);
  const proof=await this.privacy.passwordProof(userId);if(!await verifyPassword(input.password,proof))throw new DomainError('NOT_AUTHORIZED',403);
  return this.repository.request(userId,proof,{requestId:input.requestId,revision:input.revision,idempotencyKey:input.idempotencyKey},correlationId);
 }
}
export class AccountErasureProcessor{
 constructor(private readonly repository:AccountErasureRepository,private readonly errors?:ErrorReporter){}
 async runOnce(){const job=await this.repository.due();if(!job)return;try{await this.repository.execute(job.id);}catch{reportError(this.errors,new DomainError('PROVIDER_UNAVAILABLE',503),{jobId:job.id,correlationId:job.correlationId,code:'ERASURE_FAILED'});await this.repository.fail(job.id);}}
}
