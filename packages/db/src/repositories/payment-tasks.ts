import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DomainError, paymentObservationSchema, type PaymentObservation } from '@contentos/types';
import type { Database } from '../index';
import { billingOrders, payments, paymentTasks, renewalPreferences } from '../schema';
import { assertMembership, lockTenant, type Transaction } from './ledger';
const whereTask = (tenantId: string, id: string) => and(eq(paymentTasks.tenantId, tenantId), eq(paymentTasks.id, id));
const clearedLease = { leaseToken: null, leaseExpiresAt: null };
const terminal = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'RECONCILIATION']);
type Merchant = { provider: string; merchantId: string; test: boolean };
/** Internal worker boundary. No raw webhook data may be passed to observe. */
export class PaymentTaskRepository {
  constructor(private readonly db: Database, private readonly now: () => Date = () => new Date()) {}
  async dispatchable() {
    const now = this.now();
    return this.db.select({ tenantId: paymentTasks.tenantId, id: paymentTasks.id }).from(paymentTasks).where(sql`((${paymentTasks.status} in ('QUEUED','WAITING') and ${paymentTasks.nextAttemptAt} <= ${now.toISOString()}) or (${paymentTasks.status} = 'RUNNING' and ${paymentTasks.leaseExpiresAt} <= ${now.toISOString()})) and (${paymentTasks.lastDispatchedAt} is null or ${paymentTasks.lastDispatchedAt} < ${new Date(now.getTime() - 30_000).toISOString()})`).orderBy(paymentTasks.nextAttemptAt).limit(100);
  }
  async dispatched(tenantId: string, id: string) {
    await this.db.update(paymentTasks).set({ lastDispatchedAt: this.now() }).where(whereTask(tenantId, id));
  }
  private async owned(tx: Transaction, tenantId: string, id: string, token: string) {
    const [task] = await tx.select().from(paymentTasks).where(whereTask(tenantId, id));
    if (!task || task.status !== 'RUNNING' || task.leaseToken !== token || !task.leaseExpiresAt || task.leaseExpiresAt <= this.now()) throw new DomainError('CONFLICT', 409);
    return task;
  }
  async claim(tenantId: string, id: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId);
      const [task] = await tx.select().from(paymentTasks).where(whereTask(tenantId, id));
      const now = this.now();
      if (!task || terminal.has(task.status) || task.nextAttemptAt > now || (task.status === 'RUNNING' && task.leaseExpiresAt && task.leaseExpiresAt > now)) return null;
      if (task.attempt >= 240) {
        await tx.update(paymentTasks).set({ status: 'RECONCILIATION', errorCode: 'RECONCILIATION_REQUIRED', ...clearedLease }).where(whereTask(tenantId, id)); return null;
      }
      const [claimed] = await tx.update(paymentTasks).set({ status: 'RUNNING', attempt: task.attempt + 1, leaseToken: randomUUID(), leaseExpiresAt: new Date(now.getTime() + 120_000) }).where(whereTask(tenantId, id)).returning();
      return claimed ?? null;
    });
  }
  /** Commit a stable marker before POST. A known external ID always switches to GET. */
  async prepare(tenantId: string, id: string, token: string, merchant: Merchant, vaultReady = false) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId);
      const task = await this.owned(tx, tenantId, id, token);
      const [order] = await tx.select().from(billingOrders).where(and(eq(billingOrders.tenantId, tenantId), eq(billingOrders.id, id)));
      if (!order) throw new DomainError('NOT_FOUND', 404);
      if (order.provider !== merchant.provider || order.merchantId !== merchant.merchantId || order.test !== merchant.test) throw new DomainError('CONFIGURATION_REQUIRED', 503);
      const [known] = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, id)));
      if (known) return { mode: 'READ' as const, order, externalId: known.externalId };
      let permitted = true;
      try { await assertMembership(tx, order.requestedBy, tenantId, 'billing'); } catch (error) { if (error instanceof DomainError && ['NOT_FOUND', 'NOT_AUTHORIZED'].includes(error.code)) permitted = false; else throw error; }
      if (order.renewalConsentId) {
        const [preference] = await tx.select().from(renewalPreferences).where(eq(renewalPreferences.tenantId, tenantId));
        permitted &&= preference?.activeConsentId === order.renewalConsentId && preference.revision === order.renewalRevision;
      }
      // Renewal-method decryption/binding is not implemented here yet: never dispatch one speculatively.
      if (order.input.mode !== 'CHECKOUT') permitted = false;
      const now = this.now();
      const expired = task.firstSubmittedAt && (now.getTime() - task.firstSubmittedAt.getTime() >= 23 * 3600_000 || task.firstSubmittedAt > now);
      if (!permitted || expired || task.submissionCount >= 5) {
        await tx.update(paymentTasks).set({ status: task.firstSubmittedAt ? 'RECONCILIATION' : 'CANCELED', errorCode: task.firstSubmittedAt ? 'RECONCILIATION_REQUIRED' : 'NOT_AUTHORIZED', ...clearedLease }).where(whereTask(tenantId, id));
        return null;
      }
      if (order.input.mode === 'CHECKOUT' && order.input.saveMethod && !vaultReady) throw new DomainError('CONFIGURATION_REQUIRED', 503);
      const firstSubmittedAt = task.firstSubmittedAt ?? now;
      await tx.update(paymentTasks).set({ firstSubmittedAt, submissionCount: task.submissionCount + 1 }).where(whereTask(tenantId, id));
      return { mode: 'CREATE' as const, order, firstSubmittedAt, idempotencyKey: order.id };
    });
  }
  /** Records a provider-authenticated result before settlement or another asynchronous step. */
  async observe(tenantId: string, id: string, token: string, raw: PaymentObservation, confirmationUrl: string | null) {
    const observed = paymentObservationSchema.parse(raw);
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await this.owned(tx, tenantId, id, token);
      const [order] = await tx.select().from(billingOrders).where(and(eq(billingOrders.tenantId, tenantId), eq(billingOrders.id, id)));
      const [known] = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, id)));
      if (!order || observed.internalId !== id || observed.provider !== order.provider || observed.merchantId !== order.merchantId || observed.test !== order.test || observed.amountMinor !== order.amountMinor || observed.currency !== order.currency || (known && known.externalId !== observed.externalId)) throw new DomainError('CONFLICT', 409);
      if (!known) await tx.insert(payments).values({ tenantId, orderId: id, provider: observed.provider, merchantId: observed.merchantId, test: observed.test, externalId: observed.externalId });
      await tx.update(paymentTasks).set({ observation: observed, confirmationUrl }).where(whereTask(tenantId, id));
    });
  }
  /** Success is allowed only after the settlement transaction has committed. */
  async finish(tenantId: string, id: string, token: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); const task = await this.owned(tx, tenantId, id, token);
      const observed = task.observation;
      let status = 'WAITING';
      if (observed?.status === 'SUCCEEDED' && observed.paid) {
        const settled = await tx.execute(sql`select id from payment_settlements where tenant_id=${tenantId} and order_id=${id}`);
        if (!settled.length) throw new DomainError('CONFLICT', 409);
        status = 'SUCCEEDED';
      } else if (observed?.status === 'CANCELED') status = 'CANCELED';
      await tx.update(paymentTasks).set({ status, nextAttemptAt: new Date(this.now().getTime() + 60_000), errorCode: null, ...clearedLease }).where(whereTask(tenantId, id));
    });
  }
  async fail(tenantId: string, id: string, token: string, definitiveRejection: boolean) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); const task = await this.owned(tx, tenantId, id, token);
      const [known] = await tx.select({ id: payments.id }).from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.orderId, id)));
      // A rejection of a replay cannot prove that an earlier submission did not succeed.
      const failed = definitiveRejection && task.submissionCount === 1 && !known;
      await tx.update(paymentTasks).set({ status: failed ? 'FAILED' : 'WAITING', errorCode: failed ? 'PROVIDER_REJECTED' : 'RECONCILIATION_REQUIRED', nextAttemptAt: new Date(this.now().getTime() + Math.min(3600_000, 5000 * 2 ** Math.min(task.attempt, 10))), ...clearedLease }).where(whereTask(tenantId, id));
    });
  }
}
