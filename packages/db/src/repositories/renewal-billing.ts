import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DomainError, paymentReceiptSchema, type CreatePayment, type StoredPaymentRequest } from '@contentos/types';
import type { Database } from '../index';
import { billingOrders, paymentMethods, paymentTasks, plans, planVersions, renewalConsents, renewalIntents, renewalPreferences, subscriptionTerms, users, auditLogs } from '../schema';
import { assertMembership, lockTenant } from './ledger';
type Merchant={provider:'yookassa';merchantId:string;test:boolean};
type Fiscal=Omit<CreatePayment['receipt'],'customerEmail'>;
/** One automatic payment intent per last paid term; no catch-up charges for missed periods. */
export class RenewalBillingRepository {
  constructor(private readonly db:Database,private readonly now:()=>Date=()=>new Date()){}
  async due(merchant:Merchant){
    return this.db.select({tenantId:renewalPreferences.tenantId}).from(renewalPreferences).where(sql`${renewalPreferences.activeConsentId} is not null and exists (
      select 1 from subscription_terms t
      join billing_renewal_consents c on c.tenant_id=t.tenant_id and c.id=${renewalPreferences.activeConsentId} and c.plan_version_id=t.plan_version_id
      join plan_versions q on q.id=c.plan_version_id join plans p on p.id=q.plan_id and p.enabled=true
      join organization_members member on member.tenant_id=t.tenant_id and member.user_id=c.accepted_by and member.role='OWNER'
      join users u on u.id=member.user_id and u.disabled_at is null and u.email_verified_at is not null
      where t.tenant_id=${renewalPreferences.tenantId} and t.ends_at <= ${this.now().toISOString()} and t.ends_at > ${new Date(this.now().getTime()-72*3600000).toISOString()}
      and not exists (select 1 from subscription_terms newer where newer.tenant_id=t.tenant_id and newer.ends_at>t.ends_at)
      and not exists (select 1 from billing_renewal_intents i where i.tenant_id=t.tenant_id and i.term_id=t.id)
      and exists (select 1 from billing_payment_methods m join billing_orders source on source.tenant_id=m.tenant_id and source.id=m.order_id
        where m.tenant_id=t.tenant_id and m.consent_id=c.id and m.renewal_revision=${renewalPreferences.revision} and m.revoked_at is null and m.credential is not null
        and source.provider=${merchant.provider} and source.merchant_id=${merchant.merchantId} and source.test=${merchant.test})
    )`).limit(100);
  }
  async schedule(tenantId:string,merchant:Merchant,fiscal:Fiscal){
    return this.db.transaction(async tx=>{
      await lockTenant(tx,tenantId);
      const [preference]=await tx.select().from(renewalPreferences).where(eq(renewalPreferences.tenantId,tenantId));
      if(!preference?.activeConsentId)return null;
      const [consent]=await tx.select().from(renewalConsents).where(and(eq(renewalConsents.tenantId,tenantId),eq(renewalConsents.id,preference.activeConsentId)));
      if(!consent)return null;
      try{await assertMembership(tx,consent.acceptedBy,tenantId,'billing');}catch(error){if(error instanceof DomainError&&['NOT_FOUND','NOT_AUTHORIZED'].includes(error.code))return null;throw error;}
      const [term]=await tx.select().from(subscriptionTerms).where(eq(subscriptionTerms.tenantId,tenantId)).orderBy(desc(subscriptionTerms.endsAt)).limit(1);
      if(!term||term.planVersionId!==consent.planVersionId||term.endsAt>this.now()||this.now().getTime()-term.endsAt.getTime()>=72*3600000)return null;
      const [existing]=await tx.select().from(renewalIntents).where(and(eq(renewalIntents.tenantId,tenantId),eq(renewalIntents.termId,term.id)));
      if(existing)return existing;
      const [quote]=await tx.select().from(planVersions).innerJoin(plans,eq(plans.id,planVersions.planId)).where(eq(planVersions.id,consent.planVersionId)).for('share');
      if(!quote?.plans.enabled||quote.plans.code==='FREE'||quote.plan_versions.amountMinor!==consent.amountMinor||quote.plan_versions.currency!==consent.currency)return null;
      const [method]=await tx.select({id:paymentMethods.id}).from(paymentMethods).innerJoin(billingOrders,and(eq(billingOrders.tenantId,paymentMethods.tenantId),eq(billingOrders.id,paymentMethods.orderId))).where(and(eq(paymentMethods.tenantId,tenantId),eq(paymentMethods.consentId,consent.id),eq(paymentMethods.renewalRevision,preference.revision),isNull(paymentMethods.revokedAt),eq(billingOrders.provider,merchant.provider),eq(billingOrders.merchantId,merchant.merchantId),eq(billingOrders.test,merchant.test))).orderBy(desc(paymentMethods.createdAt)).limit(1);
      if(!method)return null;
      const [user]=await tx.select({email:users.email}).from(users).where(eq(users.id,consent.acceptedBy));if(!user)return null;
      const receipt=paymentReceiptSchema.parse({...fiscal,customerEmail:user.email});
      const input:StoredPaymentRequest={mode:'RENEWAL',amountMinor:consent.amountMinor,currency:'RUB',description:`Subscription ${quote.plans.code}`,receipt};
      const id=randomUUID(),correlationId=randomUUID(),inputHash=createHash('sha256').update(JSON.stringify({input,consentId:consent.id,revision:preference.revision,termId:term.id,methodId:method.id,merchant})).digest('hex');
      await tx.insert(billingOrders).values({id,tenantId,planVersionId:consent.planVersionId,requestedBy:consent.acceptedBy,kind:'RENEWAL',amountMinor:consent.amountMinor,currency:consent.currency,aiCredits:quote.plan_versions.aiCredits,videoSeconds:quote.plan_versions.videoSeconds,...merchant,renewalConsentId:consent.id,renewalRevision:preference.revision,input,inputHash,idempotencyKey:id,correlationId});
      const [intent]=await tx.insert(renewalIntents).values({orderId:id,tenantId,termId:term.id,methodId:method.id}).returning();
      await tx.insert(paymentTasks).values({id,tenantId});
      await tx.insert(auditLogs).values({tenantId,userId:consent.acceptedBy,action:'BILLING_RENEWAL_SCHEDULED',resourceId:id,correlationId,metadata:{termId:term.id,consentId:consent.id,amountMinor:consent.amountMinor}});
      return intent??null;
    });
  }
}
