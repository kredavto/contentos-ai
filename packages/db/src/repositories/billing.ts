import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError, createPaymentSchema, paymentObservationSchema, paymentSettlementEligible, type PaymentObservation, type CreatePayment } from '@contentos/types';
import type { Database } from '../index';
import { plans, planVersions, billingOrders, payments, paymentSettlements, usageLedger, auditLogs } from '../schema';
import { assertMembership, lockTenant } from './ledger';

const merchantSchema = z.object({ provider: z.literal('yookassa'), merchantId: z.string().regex(/^\d{1,32}$/), test: z.boolean() }).strict();
export class BillingRepository {
  constructor(private readonly db: Database) {}
  /** Internal checkout boundary. Recurring consent must be implemented before saveMethod=true is offered. */
  async checkout(userId: string, tenantId: string, planVersionId: string, key: string, input: Pick<Extract<CreatePayment, {mode:'CHECKOUT'}>, 'receipt' | 'returnUrl'>, merchant: z.infer<typeof merchantSchema>, correlationId: string) {
    for (const value of [userId, tenantId, planVersionId, key, correlationId]) if (!z.uuid().safeParse(value).success) throw new DomainError('INVALID_INPUT');
    const configured = merchantSchema.parse(merchant);
    const request = createPaymentSchema.parse({ ...input, amountMinor: 1, currency: 'RUB', description: 'Subscription', mode: 'CHECKOUT', saveMethod: false });
    const hash = createHash('sha256').update(JSON.stringify({ userId, planVersionId, request, configured })).digest('hex');
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'billing');
      const [existing] = await tx.select().from(billingOrders).where(and(eq(billingOrders.tenantId, tenantId), eq(billingOrders.idempotencyKey, key)));
      if (existing) { if (existing.inputHash !== hash) throw new DomainError('CONFLICT', 409); return existing; }
      const [quote] = await tx.select().from(planVersions).where(eq(planVersions.id, planVersionId));
      if (!quote) throw new DomainError('NOT_FOUND', 404);
      const [plan] = await tx.select().from(plans).where(eq(plans.id, quote.planId)).for('share');
      if (!plan?.enabled || quote.amountMinor <= 0 || plan.code === 'FREE') throw new DomainError('CONFIGURATION_REQUIRED', 503);
      const [latest] = await tx.select({ id: planVersions.id }).from(planVersions).where(eq(planVersions.planId, plan.id)).orderBy(desc(planVersions.version)).limit(1);
      if (latest?.id !== quote.id) throw new DomainError('CONFLICT', 409);
      const frozen = createPaymentSchema.parse({ ...request, amountMinor: quote.amountMinor, currency: quote.currency, description: `Subscription ${plan.code}` });
      const [order] = await tx.insert(billingOrders).values({ tenantId, planVersionId, requestedBy: userId, kind: 'START', amountMinor: quote.amountMinor, currency: quote.currency, aiCredits: quote.aiCredits, videoSeconds: quote.videoSeconds, ...configured, input: frozen, inputHash: hash, idempotencyKey: key, correlationId }).returning();
      if (!order) throw new Error('Billing order insert failed');
      await tx.insert(auditLogs).values({ tenantId, userId, action: 'BILLING_ORDER_CREATED', resourceId: order.id, correlationId, metadata: { planVersionId, amountMinor: order.amountMinor, currency: order.currency } });
      return order;
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
      if (existing) return existing;
      const payment = known ?? (await tx.insert(payments).values({ tenantId, orderId, provider: order.provider, merchantId: order.merchantId, test: order.test, externalId: observed.externalId }).returning())[0];
      if (!payment) throw new Error('Payment insert failed');
      const [settlement] = await tx.insert(paymentSettlements).values({ tenantId, orderId, paymentId: payment.id, observation: observed, correlationId: order.correlationId }).returning();
      if (!settlement) throw new Error('Settlement insert failed');
      for (const [unit, amount] of [['AI_CREDITS', order.aiCredits], ['VIDEO_SECONDS', order.videoSeconds]] as const) {
        if (!amount) continue;
        await tx.insert(usageLedger).values({ tenantId, unit, amount, type: 'PURCHASE', availableDelta: amount, reservedDelta: 0, idempotencyKey: `payment:${order.id}:${unit}`, correlationId: order.correlationId });
      }
      await tx.insert(auditLogs).values({ tenantId, action: 'PAYMENT_SETTLED', resourceId: settlement.id, correlationId: order.correlationId, metadata: { orderId, amountMinor: order.amountMinor, currency: order.currency } });
      return settlement;
    });
  }
}
