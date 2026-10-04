import { and, eq, sql } from 'drizzle-orm';
import { DomainError, type UsageUnit } from '@contentos/types';
import type { Database } from '../index';
import { organizations, organizationMembers, users, usageLedger, usageReservations, usagePolicies, trialGrants, auditLogs } from '../schema';
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export async function lockTenant(tx: Transaction, tenantId: string) {
  const [tenant] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, tenantId)).for('update');
  if (!tenant) throw new DomainError('NOT_FOUND', 404);
}
export async function assertMembership(tx: Transaction, userId: string, tenantId: string, action: 'read' | 'generate' | 'strategy' | 'approve' | 'billing' = 'read') {
  const [member] = await tx.select({ role: organizationMembers.role, disabledAt: users.disabledAt, verifiedAt: users.emailVerifiedAt }).from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId)).where(and(eq(organizationMembers.tenantId, tenantId), eq(organizationMembers.userId, userId))).for('share');
  if (!member || member.disabledAt) throw new DomainError('NOT_FOUND', 404);
  const roles = action === 'read' ? ['OWNER','ADMIN','MANAGER','EDITOR','CLIENT_APPROVER','VIEWER'] : action === 'approve' ? ['OWNER','ADMIN','MANAGER','CLIENT_APPROVER'] : action === 'billing' ? ['OWNER'] : action === 'strategy' ? ['OWNER','ADMIN','MANAGER'] : ['OWNER','ADMIN','MANAGER','EDITOR'];
  if (!roles.includes(member.role)) throw new DomainError('NOT_AUTHORIZED', 403);
  if (action !== 'read' && !member.verifiedAt) throw new DomainError('NOT_AUTHORIZED', 403);
  return member;
}
export async function balanceInTransaction(tx: Transaction, tenantId: string, unit: UsageUnit) {
  const [result] = await tx.select({ available: sql<number>`coalesce(sum(${usageLedger.availableDelta}),0)::int`, reserved: sql<number>`coalesce(sum(${usageLedger.reservedDelta}),0)::int` }).from(usageLedger).where(and(eq(usageLedger.tenantId, tenantId), eq(usageLedger.unit, unit)));
  return result ?? { available: 0, reserved: 0 };
}
export async function reserveInTransaction(tx: Transaction, tenantId: string, unit: UsageUnit, amount: number, key: string, correlationId: string) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainError('INVALID_INPUT');
  const [existing] = await tx.select().from(usageReservations).where(and(eq(usageReservations.tenantId, tenantId), eq(usageReservations.key, key)));
  if (existing) {
    if (existing.amount !== amount || existing.unit !== unit) throw new DomainError('CONFLICT', 409);
    return existing;
  }
  const balance = await balanceInTransaction(tx, tenantId, unit);
  if (balance.available < amount) throw new DomainError(unit === 'AI_CREDITS' ? 'INSUFFICIENT_CREDITS' : 'INSUFFICIENT_VIDEO_SECONDS', 402);
  const [reservation] = await tx.insert(usageReservations).values({ tenantId, unit, amount, key }).returning();
  if (!reservation) throw new Error('Reservation insert failed');
  await tx.insert(usageLedger).values({ tenantId, unit, amount, type: 'RESERVE', availableDelta: -amount, reservedDelta: amount, reservationId: reservation.id, idempotencyKey: `reserve:${reservation.id}`, correlationId });
  return reservation;
}
export async function settleInTransaction(tx: Transaction, tenantId: string, reservationId: string, outcome: 'CAPTURE' | 'RELEASE', correlationId: string) {
  const [reservation] = await tx.select().from(usageReservations).where(and(eq(usageReservations.tenantId, tenantId), eq(usageReservations.id, reservationId))).for('update');
  if (!reservation) throw new DomainError('NOT_FOUND', 404);
  if (reservation.status !== 'HELD') {
    if (reservation.status !== (outcome === 'CAPTURE' ? 'CAPTURED' : 'RELEASED')) throw new DomainError('CONFLICT', 409);
    return;
  }
  await tx.insert(usageLedger).values({ tenantId, unit: reservation.unit, amount: reservation.amount, type: outcome, availableDelta: outcome === 'RELEASE' ? reservation.amount : 0, reservedDelta: -reservation.amount, reservationId, idempotencyKey: `settle:${reservationId}`, correlationId });
  await tx.update(usageReservations).set({ status: outcome === 'CAPTURE' ? 'CAPTURED' : 'RELEASED' }).where(eq(usageReservations.id, reservationId));
}
export class LedgerRepository {
  constructor(private readonly db: Database) {}
  async overview(userId: string, tenantId: string) {
    return this.db.transaction(async tx => {
      await assertMembership(tx, userId, tenantId);
      const balances = { AI_CREDITS: await balanceInTransaction(tx, tenantId, 'AI_CREDITS'), VIDEO_SECONDS: await balanceInTransaction(tx, tenantId, 'VIDEO_SECONDS') };
      const policies = await tx.select().from(usagePolicies);
      return { balances, policies };
    });
  }
  async grantTrial(userId: string, tenantId: string, correlationId: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'billing');
      // A unique user grant prevents farming free credits by creating organizations.
      const [policy] = await tx.select().from(usagePolicies).where(eq(usagePolicies.operation, 'TRIAL'));
      if (!policy) throw new DomainError('CONFIGURATION_REQUIRED', 503);
      const [grant] = await tx.insert(trialGrants).values({ userId, tenantId }).onConflictDoNothing().returning();
      if (!grant) return { granted: false };
      await tx.insert(usageLedger).values({ tenantId, unit: policy.unit, amount: policy.amount, type: 'GRANT', availableDelta: policy.amount, reservedDelta: 0, idempotencyKey: `trial:${userId}`, correlationId });
      await tx.insert(auditLogs).values({ tenantId, userId, action: 'TRIAL_CREDITS_GRANTED', resourceId: grant.id, correlationId, metadata: { amount: policy.amount, unit: policy.unit } });
      return { granted: true };
    });
  }
  async adjust(tenantId: string, unit: UsageUnit, amount: number, key: string, correlationId: string) {
    // Internal system API only; never exposed as an unrestricted user mutation.
    if (!Number.isSafeInteger(amount) || !amount || Math.abs(amount) > 1_000_000_000) throw new DomainError('INVALID_INPUT');
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId);
      const [existing] = await tx.select().from(usageLedger).where(and(eq(usageLedger.tenantId, tenantId), eq(usageLedger.idempotencyKey, key)));
      if (existing) { if (existing.amount !== amount || existing.unit !== unit || existing.type !== 'ADJUSTMENT') throw new DomainError('CONFLICT', 409); return; }
      if ((await balanceInTransaction(tx, tenantId, unit)).available + amount < 0) throw new DomainError('INSUFFICIENT_CREDITS', 402);
      await tx.insert(usageLedger).values({ tenantId, unit, amount, type: 'ADJUSTMENT', availableDelta: amount, reservedDelta: 0, idempotencyKey: key, correlationId });
      await tx.insert(auditLogs).values({ tenantId, action: 'USAGE_ADJUSTED', correlationId, metadata: { amount, unit } });
    });
  }
  async reserve(tenantId: string, unit: UsageUnit, amount: number, key: string, correlationId: string) {
    return this.db.transaction(async tx => { await lockTenant(tx, tenantId); return reserveInTransaction(tx, tenantId, unit, amount, key, correlationId); });
  }
  async settle(tenantId: string, reservationId: string, outcome: 'CAPTURE' | 'RELEASE', correlationId: string) {
    return this.db.transaction(async tx => { await lockTenant(tx, tenantId); await settleInTransaction(tx, tenantId, reservationId, outcome, correlationId); });
  }
}
