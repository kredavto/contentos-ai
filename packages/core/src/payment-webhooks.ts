import { BillingRepository, PaymentWebhookRepository } from '@contentos/db';
import { DomainError, type PaymentProvider } from '@contentos/types';
import { CredentialVault } from './credential-vault';
import { PaymentMethodService } from './payment-methods';
type Merchant={provider:string;merchantId:string;test:boolean};
export class PaymentWebhookService {
  constructor(private readonly repository:PaymentWebhookRepository,private readonly merchant:Merchant|null){}
  async receive(raw:unknown,correlationId:string){
    if(!this.merchant)throw new DomainError('CONFIGURATION_REQUIRED',503);
    await this.repository.receive(raw,this.merchant,correlationId);
  }
}
export class PaymentWebhookProcessor {
  private readonly methods:PaymentMethodService;
  constructor(private readonly repository:PaymentWebhookRepository,private readonly billing:BillingRepository,private readonly provider:PaymentProvider|null,private readonly merchant:Merchant|null,vault:CredentialVault|null){this.methods=new PaymentMethodService(billing,vault);}
  async run(id:string){
    if(!this.provider||!this.merchant)return;
    const event=await this.repository.claim(id,this.merchant);if(!event?.leaseToken)return;
    const token=event.leaseToken;
    try{
      const result=await this.provider.inspect(event.externalId,{correlationId:event.correlationId,signal:AbortSignal.timeout(45000)});
      const order=await this.repository.reconcile(id,token,result.observation,result.confirmationUrl);
      if(!order){await this.repository.finish(id,token,'IGNORED');return;}
      if(result.observation.status==='SUCCEEDED'&&result.observation.paid){
        await this.billing.settle(order.tenantId,order.orderId,result.observation);
        await this.methods.capture(order.tenantId,order.orderId,result);
      }
      // A forged early terminal event cannot consume the real future notification's dedupe key.
      const pending=result.observation.status==='PENDING'||(result.observation.status==='WAITING_CAPTURE'&&event.eventType!=='payment.waiting_for_capture');
      await this.repository.finish(id,token,pending?'RETRY':'PROCESSED');
    }catch(error){
      try{await this.repository.finish(id,token,'RETRY');}catch(failure){if(!(failure instanceof DomainError&&failure.code==='CONFLICT'))throw failure;}
      console.log(JSON.stringify({event:'payment_webhook_error',eventId:id,code:error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE'}));
    }
  }
}
