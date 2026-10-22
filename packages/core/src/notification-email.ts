import {NotificationEmailRepository} from '@contentos/db';
import {ProviderRequestError,type EmailProvider,type ErrorReporter} from '@contentos/types';
import {notificationEmailTitle} from './notifications';
import {reportError} from './error-reporting';
export class NotificationEmailProcessor {
  constructor(private readonly repository:NotificationEmailRepository,private readonly provider:EmailProvider|null,private readonly appUrl:string,private readonly appName:string,private readonly errors?:ErrorReporter){}
  async runOnce(id?:string){
    if(!this.provider)return false;
    const row=await this.repository.claim(id);if(!row?.leaseToken)return false;
    let submitted=false,status='canceled';
    try{
      const message=await this.repository.begin(row.id,row.leaseToken);if(!message)return true;
      const title=notificationEmailTitle(message.type),link=new URL(`/notifications?organization=${message.tenantId}`,this.appUrl).toString();
      submitted=true;
      await this.provider.send({recipient:message.recipient,subject:`${this.appName}: ${title}`,text:`${title}\n\nОткройте уведомления, чтобы посмотреть актуальные сведения:\n${link}\n\nВы получили письмо, потому что включили почтовые уведомления в этой организации. Отключить их можно на той же странице.`},{internalId:row.id,tenantId:row.tenantId,idempotencyKey:row.id,correlationId:row.id,signal:AbortSignal.timeout(15000)});
      status=await this.repository.complete(row.id,row.leaseToken)?'sent':'lease_lost';
    }catch(error){
      reportError(this.errors,error,{correlationId:row.id,jobId:row.id});
      const uncertain=submitted&&!(error instanceof ProviderRequestError&&error.definitiveRejection);
      await this.repository.fail(row.id,row.leaseToken,uncertain);status=uncertain?'reconciliation':'failed';
    }finally{console.info(JSON.stringify({event:'notification_email_delivery',correlationId:row.id,status}));}
    return true;
  }
}
