import { z } from 'zod';
import { EmailRepository } from '@contentos/db';
import { DomainError, type EmailProvider } from '@contentos/types';
import { CredentialVault } from './credential-vault';
const messageSchema=z.object({recipient:z.email().max(254),subject:z.string().min(1).max(200),text:z.string().min(1).max(12000)}).strict();
export class EmailProcessor {
  constructor(private readonly repository:EmailRepository,private readonly provider:EmailProvider|null,private readonly vault:CredentialVault|null){}
  async runOnce(id?:string){
    if(!this.provider||!this.vault)return false;
    const message=await this.repository.claim(id);if(!message?.leaseToken||!message.payload)return false;
    const started=performance.now();let status='failed';
    try{
      const input=messageSchema.parse(JSON.parse(this.vault.decrypt(message.payload,{kind:'AUTH_EMAIL',userId:message.userId,messageId:message.id})));
      await this.provider.send(input,{internalId:message.id,tenantId:'',idempotencyKey:message.id,correlationId:message.correlationId,signal:AbortSignal.timeout(15000)});
      await this.repository.complete(message.id,message.leaseToken);status='sent';
    }catch(error){
      const code=error instanceof z.ZodError||error instanceof SyntaxError?'INVALID_INPUT':error instanceof DomainError&&error.code==='CONFIGURATION_REQUIRED'?'CONFIGURATION_REQUIRED':'PROVIDER_UNAVAILABLE';
      await this.repository.fail(message.id,message.leaseToken,code);
    }finally{console.info(JSON.stringify({event:'auth_email_delivery',requestId:message.id,correlationId:message.correlationId,status,durationMs:Math.round(performance.now()-started)}));}
    return true;
  }
}
