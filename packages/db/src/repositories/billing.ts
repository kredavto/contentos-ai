import { createHash } from 'node:crypto';
import { and, desc, eq, gt, lte } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError, createPaymentSchema, paymentObservationSchema, paymentSettlementEligible, monthlyBillingBoundary, type PaymentObservation, type CreatePayment, type EncryptedCredential } from '@contentos/types';
import type { Database } from '../index';
import { plans, planVersions, billingOrders, payments, paymentSettlements, usageLedger, auditLogs, subscriptions, subscriptionTerms, renewalConsents, renewalPreferences, paymentMethods, paymentTasks, users } from '../schema';
import { assertMembership, lockTenant, type Transaction } from './ledger';

const merchantSchema = z.object({ provider: z.literal('yookassa'), merchantId: z.string().regex(/^\d{1,32}$/), test: z.boolean() }).strict();
export class BillingRepository {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}
  async catalog(userId: string, tenantId: string) {
    return this.db.transaction(async tx => {
      await assertMembership(tx, userId, tenantId, 'billing');
      const rows = await tx.selectDistinctOn([plans.id], { planVersionId: planVersions.id, code: plans.code, name: plans.name, amountMinor: planVersions.amountMinor, currency: planVersions.currency, aiCredits: planVersions.aiCredits, videoSeconds: planVersions.videoSeconds }).from(plans).innerJoin(planVersions, eq(planVersions.planId, plans.id)).where(eq(plans.enabled, true)).orderBy(plans.id, desc(planVersions.version));
      return rows.filter(row => row.code !== 'FREE' && row.amountMinor > 0).sort((a,b) => ['START','CREATOR','EXPERT','AGENCY'].indexOf(a.code) - ['START','CREATOR','EXPERT','AGENCY'].indexOf(b.code));
    });
  }
  async receiptEmail(userId: string, tenantId: string) {
    return this.db.transaction(async tx => {
      await assertMembership(tx, userId, tenantId, 'billing');
      const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId));
      if (!user) throw new DomainError('NOT_FOUND', 404);
      return user.email;
    });
  }
  async orderStatus(userId: string, tenantId: string, orderId: string) {
    return this.db.transaction(async tx => {
      await assertMembership(tx, userId, tenantId, 'billing');
      const [order] = await tx.select({ id: billingOrders.id, planVersionId: billingOrders.planVersionId, amountMinor: billingOrders.amountMinor, currency: billingOrders.currency, createdAt: billingOrders.createdAt }).from(billingOrders).where(and(eq(billingOrders.tenantId, tenantId), eq(billingOrders.id, orderId)));
      if (!order) throw new DomainError('NOT_FOUND', 404);
      const [task] = await tx.select({ status: paymentTasks.status, confirmationUrl: paymentTasks.confirmationUrl, errorCode: paymentTasks.errorCode }).from(paymentTasks).where(and(eq(paymentTasks.tenantId, tenantId), eq(paymentTasks.id, orderId)));
      const [settled] = await tx.select({ id: paymentSettlements.id }).from(paymentSettlements).where(and(eq(paymentSettlements.tenantId, tenantId), eq(paymentSettlements.orderId, orderId)));
      const status = settled ? 'PAID' : task?.status ?? 'RECONCILIATION';
      return { ...order, status, confirmationUrl: !settled && task && ['WAITING', 'RUNNING'].includes(task.status) ? task.confirmationUrl : null, errorCode: settled ? null : task?.errorCode ?? null };
    });
  }
  async overview(userId: string, tenantId: string) {
    return this.db.transaction(async tx => {
      await assertMembership(tx, userId, tenantId, 'billing');
      const now = this.now();
      const [current] = await tx.select().from(subscriptionTerms).where(and(eq(subscriptionTerms.tenantId, tenantId), lte(subscriptionTerms.startsAt, now), gt(subscriptionTerms.endsAt, now))).limit(1);
      const upcoming = await tx.select().from(subscriptionTerms).where(and(eq(subscriptionTerms.tenantId, tenantId), gt(subscriptionTerms.startsAt, now))).orderBy(subscriptionTerms.startsAt).limit(20);
      const history = await tx.select().from(subscriptionTerms).where(eq(subscriptionTerms.tenantId, tenantId)).orderBy(desc(subscriptionTerms.startsAt)).limit(20);
      const orders = await tx.select({ id: billingOrders.id, planVersionId: billingOrders.planVersionId, kind: billingOrders.kind, amountMinor: billingOrders.amountMinor, currency: billingOrders.currency, createdAt: billingOrders.createdAt }).from(billingOrders).where(eq(billingOrders.tenantId, tenantId)).orderBy(desc(billingOrders.createdAt)).limit(20);
      return { status: current ? 'ACTIVE' as const : 'INACTIVE' as const, current: current ?? null, upcoming, history, orders };
    });
  }
  private async recordTerm(tx: Transaction, order: typeof billingOrders.$inferSelect, paidAt: Date) {
    const [existing] = await tx.select({ id: subscriptionTerms.id }).from(subscriptionTerms).where(and(eq(subscriptionTerms.tenantId, order.tenantId), eq(subscriptionTerms.orderId, order.id)));
    if (existing) return;
    let [subscription] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, order.tenantId));
    if (!subscription) [subscription] = await tx.insert(subscriptions).values({ tenantId: order.tenantId }).returning();
    if (!subscription) throw new Error('Subscription insert failed');
    const [lastTerm] = await tx.select().from(subscriptionTerms).where(eq(subscriptionTerms.tenantId, order.tenantId)).orderBy(desc(subscriptionTerms.endsAt)).limit(1);
    // Automatic renewal retains its calendar anchor during the bounded retry window.
    // Manual purchases after expiry establish a new full-month anchor.
    const continuationWindow = order.kind === 'RENEWAL' ? 72 * 3600000 : 0;
    const continuing = lastTerm && lastTerm.endsAt.getTime() + continuationWindow >= paidAt.getTime();
    const anchorAt = continuing ? lastTerm.anchorAt : paidAt;
    const monthIndex = continuing ? lastTerm.monthIndex + 1 : 1;
    const startsAt = monthlyBillingBoundary(anchorAt, monthIndex - 1), endsAt = monthlyBillingBoundary(anchorAt, monthIndex);
    await tx.insert(subscriptionTerms).values({ tenantId: order.tenantId, subscriptionId: subscription.id, orderId: order.id, planVersionId: order.planVersionId, anchorAt, monthIndex, startsAt, endsAt });
  }
  /** Internal checkout boundary. Consent and its revision are frozen with the order. */
  async checkout(userId: string, tenantId: string, planVersionId: string, key: string, input: Pick<Extract<CreatePayment, {mode:'CHECKOUT'}>, 'receipt' | 'returnUrl'> & { renewal?: { consentId: string; revision: number } }, merchant: z.infer<typeof merchantSchema>, correlationId: string) {
    for (const value of [userId, tenantId, planVersionId, key, correlationId]) if (!z.uuid().safeParse(value).success) throw new DomainError('INVALID_INPUT');
    const configured = merchantSchema.parse(merchant);
    const renewal = input.renewal === undefined ? undefined : z.object({ consentId: z.uuid(), revision: z.number().int().positive() }).strict().parse(input.renewal);
    const request = createPaymentSchema.parse({ receipt: input.receipt, returnUrl: input.returnUrl, amountMinor: 1, currency: 'RUB', description: 'Subscription', mode: 'CHECKOUT', saveMethod: Boolean(renewal) });
    const hash = createHash('sha256').update(JSON.stringify({ userId, planVersionId, request, configured, ...(renewal ? { renewal } : {}) })).digest('hex');
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'billing');
      const [existing] = await tx.select().from(billingOrders).where(and(eq(billingOrders.tenantId, tenantId), eq(billingOrders.idempotencyKey, key)));
      if (existing) { if (existing.inputHash !== hash) throw new DomainError('CONFLICT', 409); return existing; }
      if (renewal) {
        const [preference] = await tx.select().from(renewalPreferences).where(eq(renewalPreferences.tenantId, tenantId));
        const [consent] = await tx.select().from(renewalConsents).where(and(eq(renewalConsents.tenantId, tenantId), eq(renewalConsents.id, renewal.consentId)));
        if (preference?.activeConsentId !== renewal.consentId || preference.revision !== renewal.revision || consent?.planVersionId !== planVersionId) throw new DomainError('CONSENT_REQUIRED', 409);
      }
      const [quote] = await tx.select().from(planVersions).where(eq(planVersions.id, planVersionId));
      if (!quote) throw new DomainError('NOT_FOUND', 404);
      const [plan] = await tx.select().from(plans).where(eq(plans.id, quote.planId)).for('share');
      if (!plan?.enabled || quote.amountMinor <= 0 || plan.code === 'FREE') throw new DomainError('CONFIGURATION_REQUIRED', 503);
      const [latest] = await tx.select({ id: planVersions.id }).from(planVersions).where(eq(planVersions.planId, plan.id)).orderBy(desc(planVersions.version)).limit(1);
      if (latest?.id !== quote.id) throw new DomainError('CONFLICT', 409);
      const frozen = createPaymentSchema.parse({ ...request, amountMinor: quote.amountMinor, currency: quote.currency, description: `Subscription ${plan.code}` });
      const [order] = await tx.insert(billingOrders).values({ tenantId, planVersionId, requestedBy: userId, kind: 'START', amountMinor: quote.amountMinor, currency: quote.currency, aiCredits: quote.aiCredits, videoSeconds: quote.videoSeconds, ...configured, renewalConsentId: renewal?.consentId ?? null, renewalRevision: renewal?.revision ?? null, input: frozen, inputHash: hash, idempotencyKey: key, correlationId }).returning();
      if (!order) throw new Error('Billing order insert failed');
      await tx.insert(paymentTasks).values({ id: order.id, tenantId });
      await tx.insert(auditLogs).values({ tenantId, userId, action: 'BILLING_ORDER_CREATED', resourceId: order.id, correlationId, metadata: { planVersionId, amountMinor: order.amountMinor, currency: order.currency } });
      return order;
    });
  }
  /** Worker-only. Late provider results cannot resurrect a canceled or replaced mandate. */
  async attachSavedMethod(tenantId: string, orderId: string, raw: PaymentObservation, credential: EncryptedCredential) {
    const observed = paymentObservationSchema.parse(raw);
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId);
      const [order] = await tx.select().from(billingOrders).where(and(eq(billingOrders.tenantId, tenantId), eq(billingOrders.id, orderId)));
      if (!order) throw new DomainError('NOT_FOUND', 404);
      if (!order.renewalConsentId || !order.renewalRevision) return { saved: false };
      const [preference] = await tx.select().from(renewalPreferences).where(eq(renewalPreferences.tenantId, tenantId));
      if (preference?.activeConsentId !== order.renewalConsentId || preference.revision !== order.renewalRevision) return { saved: false };
      try { await assertMembership(tx, order.requestedBy, tenantId, 'billing'); } catch (error) { if (error instanceof DomainError && ['NOT_FOUND', 'NOT_AUTHORIZED'].includes(error.code)) return { saved: false }; throw error; }
      const [payment] = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, orderId)));
      const [settlement] = await tx.select({ id: paymentSettlements.id }).from(paymentSettlements).where(and(eq(paymentSettlements.tenantId, tenantId), eq(paymentSettlements.orderId, orderId)));
      if (!payment || !settlement || !paymentSettlementEligible({ provider: order.provider, merchantId: order.merchantId, test: order.test, internalId: orderId, externalId: payment.externalId, amountMinor: order.amountMinor, currency: 'RUB' }, observed)) throw new DomainError('CONFLICT', 409);
      const [existing] = await tx.select().from(paymentMethods).where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.orderId, orderId)));
      if (existing) return { saved: existing.revokedAt === null };
      await tx.insert(paymentMethods).values({ id: orderId, tenantId, orderId, consentId: order.renewalConsentId, renewalRevision: order.renewalRevision, credential });
      await tx.insert(auditLogs).values({ tenantId, action: 'BILLING_PAYMENT_METHOD_SAVED', resourceId: orderId, correlationId: order.correlationId, metadata: { consentId: order.renewalConsentId } });
      return { saved: true };
    });
  }
  /** Worker-only: observation must come from an authenticated provider read, never the webhook payload. */
  async settle(tenantId: string, orderId: string, raw: PaymentObservation) {
    const observed = paymentObservationSchema.parse(raw);
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId);
      const [order] = await tx.select().from(billingOrders).where(and(eq(billingOrders.tenantId, tenantId), eq(billingOrders.id, orderId)));
      if (!order) throw new DomainError('NOT_FOUND', 404);
      const [known] = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, orderId)));
      const expected = { provider: order.provider, merchantId: order.merchantId, test: order.test, internalId: order.id, externalId: known?.externalId ?? observed.externalId, amountMinor: order.amountMinor, currency: 'RUB' as const };
      if (!paymentSettlementEligible(expected, observed)) throw new DomainError('CONFLICT', 409);
      const [existing] = await tx.select().from(paymentSettlements).where(and(eq(paymentSettlements.tenantId, tenantId), eq(paymentSettlements.orderId, orderId)));
      if (existing) { await this.recordTerm(tx, order, existing.createdAt); return existing; }
      const payment = known ?? (await tx.insert(payments).values({ tenantId, orderId, provider: order.provider, merchantId: order.merchantId, test: order.test, externalId: observed.externalId }).returning())[0];
      if (!payment) throw new Error('Payment insert failed');
      const [settlement] = await tx.insert(paymentSettlements).values({ tenantId, orderId, paymentId: payment.id, observation: observed, correlationId: order.correlationId }).returning();
      if (!settlement) throw new Error('Settlement insert failed');
      await this.recordTerm(tx, order, this.now());
      for (const [unit, amount] of [['AI_CREDITS', order.aiCredits], ['VIDEO_SECONDS', order.videoSeconds]] as const) {
        if (!amount) continue;
        await tx.insert(usageLedger).values({ tenantId, unit, amount, type: 'PURCHASE', availableDelta: amount, reservedDelta: 0, idempotencyKey: `payment:${order.id}:${unit}`, correlationId: order.correlationId });
      }
      await tx.insert(auditLogs).values({ tenantId, action: 'PAYMENT_SETTLED', resourceId: settlement.id, correlationId: order.correlationId, metadata: { orderId, amountMinor: order.amountMinor, currency: order.currency } });
      return settlement;
    });
  }
}
