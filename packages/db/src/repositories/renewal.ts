import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { DomainError, minorToRubles, renewalAcceptanceSchema, renewalCancellationSchema, type RenewalAcceptance, type RenewalCancellation } from '@contentos/types';
import type { Database } from '../index';
import { plans, planVersions, renewalConsents, renewalPreferences, renewalChanges, auditLogs } from '../schema';
import { assertMembership, lockTenant, type Transaction } from './ledger';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function quotePolicy(tx: Transaction, versionId: string) {
  const [quote] = await tx.select().from(planVersions).where(eq(planVersions.id, versionId));
  if (!quote) throw new DomainError('NOT_FOUND', 404);
  const [plan] = await tx.select().from(plans).where(eq(plans.id, quote.planId)).for('share');
  if (!plan?.enabled || plan.code === 'FREE' || quote.amountMinor <= 0) throw new DomainError('CONFIGURATION_REQUIRED', 503);
  const [latest] = await tx.select({ id: planVersions.id }).from(planVersions).where(eq(planVersions.planId, plan.id)).orderBy(desc(planVersions.version)).limit(1);
  if (latest?.id !== quote.id) throw new DomainError('CONFLICT', 409);
  const policyVersion = '2026-10-04-renewal-v1';
  const text = `Разрешаю сохранить способ оплаты в YooKassa и автоматически оплачивать тариф ${plan.code} для этой организации каждый месяц по ${minorToRubles(quote.amountMinor)} RUB. Следующая оплата продлевает подписку на один месяц; дата следующего списания будет показана в разделе «Биллинг». Цена этого согласия не меняется без нового подтверждения. Могу отключить продление в разделе «Биллинг» до отправки следующего платежа. Отключение сохраняет уже оплаченный период и не отменяет платёж, ранее отправленный провайдеру. Подтверждение само по себе не списывает деньги.`;
  return { quote, policy: { planVersionId: quote.id, policyVersion, text, textHash: hash(text), amountMinor: quote.amountMinor, currency: quote.currency } };
}
export class RenewalRepository {
  constructor(private readonly db: Database) {}
  async overview(userId: string, tenantId: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'billing');
      const [preference] = await tx.select().from(renewalPreferences).where(eq(renewalPreferences.tenantId, tenantId));
      const [active] = preference?.activeConsentId ? await tx.select({ id: renewalConsents.id, planVersionId: renewalConsents.planVersionId, amountMinor: renewalConsents.amountMinor, currency: renewalConsents.currency, policyVersion: renewalConsents.policyVersion, policyText: renewalConsents.policyText, createdAt: renewalConsents.createdAt }).from(renewalConsents).where(and(eq(renewalConsents.tenantId, tenantId), eq(renewalConsents.id, preference.activeConsentId))) : [];
      const history = await tx.select({ id: renewalChanges.id, consentId: renewalChanges.consentId, revision: renewalChanges.revision, operation: renewalChanges.operation, createdAt: renewalChanges.createdAt }).from(renewalChanges).where(eq(renewalChanges.tenantId, tenantId)).orderBy(desc(renewalChanges.revision)).limit(20);
      return { revision: preference?.revision ?? 0, active: active ?? null, history };
    });
  }
  async preview(userId: string, tenantId: string, planVersionId: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'billing');
      const { policy } = await quotePolicy(tx, planVersionId);
      const [preference] = await tx.select().from(renewalPreferences).where(eq(renewalPreferences.tenantId, tenantId));
      return { ...policy, expectedRevision: preference?.revision ?? 0 };
    });
  }
  async accept(userId: string, tenantId: string, raw: RenewalAcceptance, request: { ip: string; userAgent: string }, correlationId: string) {
    const input = renewalAcceptanceSchema.parse(raw), inputHash = hash(JSON.stringify({ userId, operation: 'ENABLE', input }));
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'billing');
      const [existing] = await tx.select().from(renewalChanges).where(and(eq(renewalChanges.tenantId, tenantId), eq(renewalChanges.idempotencyKey, input.idempotencyKey)));
      if (existing) { if (existing.inputHash !== inputHash) throw new DomainError('CONFLICT', 409); return existing; }
      const [preference] = await tx.select().from(renewalPreferences).where(eq(renewalPreferences.tenantId, tenantId));
      if ((preference?.revision ?? 0) !== input.expectedRevision) throw new DomainError('CONFLICT', 409);
      const { policy } = await quotePolicy(tx, input.planVersionId);
      if (input.policyVersion !== policy.policyVersion || input.textHash !== policy.textHash) throw new DomainError('CONFLICT', 409);
      const [consent] = await tx.insert(renewalConsents).values({ tenantId, planVersionId: input.planVersionId, policyVersion: policy.policyVersion, policyText: policy.text, textHash: policy.textHash, amountMinor: policy.amountMinor, currency: policy.currency, acceptedBy: userId, ipAddress: request.ip.slice(0,64), userAgent: request.userAgent.slice(0,512) }).returning();
      if (!consent) throw new Error('Renewal consent insert failed');
      const revision = input.expectedRevision + 1;
      await tx.insert(renewalPreferences).values({ tenantId, activeConsentId: consent.id, revision }).onConflictDoUpdate({ target: renewalPreferences.tenantId, set: { activeConsentId: consent.id, revision, updatedAt: new Date() } });
      const [change] = await tx.insert(renewalChanges).values({ tenantId, consentId: consent.id, revision, operation: 'ENABLE', actorId: userId, idempotencyKey: input.idempotencyKey, inputHash, correlationId }).returning();
      if (!change) throw new Error('Renewal change insert failed');
      await tx.insert(auditLogs).values({ tenantId, userId, action: 'BILLING_RENEWAL_ENABLED', resourceId: consent.id, correlationId, metadata: { revision, planVersionId: input.planVersionId } });
      return change;
    });
  }
  async cancel(userId: string, tenantId: string, raw: RenewalCancellation, correlationId: string) {
    const input = renewalCancellationSchema.parse(raw), inputHash = hash(JSON.stringify({ userId, operation: 'DISABLE', input }));
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'billing');
      const [existing] = await tx.select().from(renewalChanges).where(and(eq(renewalChanges.tenantId, tenantId), eq(renewalChanges.idempotencyKey, input.idempotencyKey)));
      if (existing) { if (existing.inputHash !== inputHash) throw new DomainError('CONFLICT', 409); return existing; }
      const [preference] = await tx.select().from(renewalPreferences).where(eq(renewalPreferences.tenantId, tenantId));
      if ((preference?.revision ?? 0) !== input.expectedRevision) throw new DomainError('CONFLICT', 409);
      const revision = input.expectedRevision + 1, consentId = preference?.activeConsentId ?? null;
      await tx.insert(renewalPreferences).values({ tenantId, activeConsentId: null, revision }).onConflictDoUpdate({ target: renewalPreferences.tenantId, set: { activeConsentId: null, revision, updatedAt: new Date() } });
      const [change] = await tx.insert(renewalChanges).values({ tenantId, consentId, revision, operation: 'DISABLE', actorId: userId, idempotencyKey: input.idempotencyKey, inputHash, correlationId }).returning();
      if (!change) throw new Error('Renewal change insert failed');
      await tx.insert(auditLogs).values({ tenantId, userId, action: 'BILLING_RENEWAL_DISABLED', resourceId: change.id, correlationId, metadata: { revision, consentId } });
      return change;
    });
  }
}
