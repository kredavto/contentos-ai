import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DomainError, paymentNotificationSchema, paymentObservationSchema, type PaymentObservation } from '@contentos/types';
import type { Database } from '../index';
import { billingOrders, payments, paymentTasks, webhookEvents } from '../schema';
import { lockTenant, type Transaction } from './ledger';
import { AuthRepository } from './auth';
type Merchant = { provider: string; merchantId: string; test: boolean };
const release = { leaseToken: null, leaseExpiresAt: null };
export class PaymentWebhookRepository {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}
  async receive(raw: unknown, merchant: Merchant, correlationId: string) {
    const notification = paymentNotificationSchema.parse(raw);
    if (!await new AuthRepository(this.db).rateLimit(`payment-webhooks:${merchant.provider}:${merchant.merchantId}:${merchant.test}`, 600, 60)) throw new DomainError('RATE_LIMITED',429);
    const providerEventId = `${notification.event}:${notification.object.id}`;
    // No raw body, card data, receipt email, or unverified tenant/order IDs are retained.
    await this.db.insert(webhookEvents).values({ ...merchant, providerEventId, eventType: notification.event, externalId: notification.object.id, correlationId }).onConflictDoUpdate({ target:[webhookEvents.provider,webhookEvents.merchantId,webhookEvents.test,webhookEvents.providerEventId], set:{status:'RETRY',attempt:0,nextAttemptAt:this.now(),errorCode:null}, setWhere:and(eq(webhookEvents.status,'RECONCILIATION'),sql`${webhookEvents.nextAttemptAt} <= ${this.now().toISOString()}`) });
  }
  async due() {
    const now = this.now().toISOString();
    return this.db.select({id:webhookEvents.id}).from(webhookEvents).where(sql`((${webhookEvents.status} in ('RECEIVED','RETRY') and ${webhookEvents.nextAttemptAt} <= ${now}) or (${webhookEvents.status} = 'PROCESSING' and ${webhookEvents.leaseExpiresAt} <= ${now})) and (${webhookEvents.lastDispatchedAt} is null or ${webhookEvents.lastDispatchedAt} < ${new Date(this.now().getTime()-30000).toISOString()})`).orderBy(webhookEvents.nextAttemptAt).limit(100);
  }
  async dispatched(id:string) { await this.db.update(webhookEvents).set({lastDispatchedAt:this.now()}).where(eq(webhookEvents.id,id)); }
  async claim(id:string, merchant:Merchant) {
    return this.db.transaction(async tx => {
      const [event]=await tx.select().from(webhookEvents).where(eq(webhookEvents.id,id)).for('update');
      const now=this.now();
      if (!event || event.provider!==merchant.provider || event.merchantId!==merchant.merchantId || event.test!==merchant.test || ['PROCESSED','IGNORED','RECONCILIATION'].includes(event.status) || event.nextAttemptAt>now || (event.status==='PROCESSING' && event.leaseExpiresAt && event.leaseExpiresAt>now)) return null;
      if(event.attempt>=24){await tx.update(webhookEvents).set({status:'RECONCILIATION',errorCode:'RECONCILIATION_REQUIRED',...release}).where(eq(webhookEvents.id,id));return null;}
      const [claimed]=await tx.update(webhookEvents).set({status:'PROCESSING',attempt:event.attempt+1,leaseToken:randomUUID(),leaseExpiresAt:new Date(now.getTime()+120000)}).where(eq(webhookEvents.id,id)).returning();
      return claimed??null;
    });
  }
  private async owned(tx:Transaction,id:string,token:string) {
    const [event]=await tx.select().from(webhookEvents).where(eq(webhookEvents.id,id)).for('update');
    if(!event||event.status!=='PROCESSING'||event.leaseToken!==token||!event.leaseExpiresAt||event.leaseExpiresAt<=this.now())throw new DomainError('CONFLICT',409);
    return event;
  }
  /** Only the worker may supply this authenticated API observation. Body fields never reach here. */
  async reconcile(id:string,token:string,raw:PaymentObservation,confirmationUrl:string|null) {
    const observed=paymentObservationSchema.parse(raw);
    return this.db.transaction(async tx => {
      const event=await this.owned(tx,id,token);
      if(observed.provider!==event.provider||observed.merchantId!==event.merchantId||observed.test!==event.test||observed.externalId!==event.externalId)throw new DomainError('CONFLICT',409);
      const [order]=await tx.select().from(billingOrders).where(eq(billingOrders.id,observed.internalId));
      if(!order)return null;
      await lockTenant(tx,order.tenantId);
      if(order.provider!==observed.provider||order.merchantId!==observed.merchantId||order.test!==observed.test||order.amountMinor!==observed.amountMinor||order.currency!==observed.currency)throw new DomainError('CONFLICT',409);
      const [task]=await tx.select().from(paymentTasks).where(and(eq(paymentTasks.tenantId,order.tenantId),eq(paymentTasks.id,order.id)));
      const [known]=await tx.select().from(payments).where(and(eq(payments.tenantId,order.tenantId),eq(payments.orderId,order.id)));
      if(known && known.externalId!==observed.externalId)throw new DomainError('CONFLICT',409);
      if(!known && !task?.firstSubmittedAt)throw new DomainError('CONFLICT',409);
      // Wait for a current checkout attempt instead of overwriting its lease or racing its result.
      if(task?.status==='RUNNING' && task.leaseExpiresAt && task.leaseExpiresAt>this.now())throw new DomainError('CONFLICT',409);
      if(!known)await tx.insert(payments).values({tenantId:order.tenantId,orderId:order.id,provider:order.provider,merchantId:order.merchantId,test:order.test,externalId:observed.externalId});
      // Successful local history is never downgraded by a delayed observation.
      if(task && task.status!=='SUCCEEDED')await tx.update(paymentTasks).set({status:'WAITING',observation:observed,confirmationUrl,nextAttemptAt:this.now(),errorCode:null,...release}).where(and(eq(paymentTasks.tenantId,order.tenantId),eq(paymentTasks.id,order.id)));
      return {tenantId:order.tenantId,orderId:order.id};
    });
  }
  async finish(id:string,token:string,status:'PROCESSED'|'IGNORED'|'RETRY') {
    return this.db.transaction(async tx => {
      const event=await this.owned(tx,id,token);
      await tx.update(webhookEvents).set({status,nextAttemptAt:new Date(this.now().getTime()+Math.min(3600000,5000*2**Math.min(event.attempt,10))),errorCode:status==='RETRY'?'RECONCILIATION_REQUIRED':null,...release}).where(eq(webhookEvents.id,id));
    });
  }
}
