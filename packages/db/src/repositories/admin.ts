import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, isNull, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { DomainError, type AdminPlanInput, type AdminListInput, type AdminRevokeSessionsInput, type AdminRow } from '@contentos/types';
import type { Database } from '../index';
import * as s from '../schema';
import type { Transaction } from './ledger';
export async function assertPlatformOperator(tx: Transaction, userId: string) {
  const [user] = await tx.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.id, userId), isNull(s.users.disabledAt), isNotNull(s.users.emailVerifiedAt))).for('share');
  if (!user) throw new DomainError('NOT_AUTHORIZED', 403);
  const [operator] = await tx.select({ role: s.platformOperators.role }).from(s.platformOperators)
    .where(and(eq(s.platformOperators.userId, userId), isNull(s.platformOperators.revokedAt))).for('share');
  if (!operator) throw new DomainError('NOT_AUTHORIZED', 403);
  return operator;
}
export class AdminRepository {
  constructor(private readonly db: Database) {}
  identity(userId: string) { return this.db.transaction(tx => assertPlatformOperator(tx, userId)); }
  async access(userId: string, correlationId: string) {
    return this.db.transaction(async tx => {
      const operator = await assertPlatformOperator(tx, userId);
      await tx.insert(s.auditLogs).values({ userId, action: 'ADMIN_CONFIGURATION_READ', correlationId });
      return operator;
    });
  }
  async list(userId: string, input: AdminListInput, correlationId: string) {
    return this.db.transaction(async tx => {
      const operator = await assertPlatformOperator(tx, userId);
      const scope = (table: { id: AnyPgColumn; createdAt: AnyPgColumn }, tenant?: AnyPgColumn, extra?: SQL) => and(
        input.beforeAt && input.beforeId ? or(lt(table.createdAt, new Date(input.beforeAt)), and(eq(table.createdAt, new Date(input.beforeAt)), lt(table.id, input.beforeId))) : undefined,
        input.tenantId && tenant ? eq(tenant, input.tenantId) : undefined, extra,
      );
      const limit = input.limit + 1;
      let rows: AdminRow[];
      switch (input.category) {
        case 'users': rows = await tx.select({ id: s.users.id, email: s.users.email, name: s.users.name, verifiedAt: s.users.emailVerifiedAt, disabledAt: s.users.disabledAt, createdAt: s.users.createdAt }).from(s.users).where(scope(s.users, undefined, input.userId ? eq(s.users.id, input.userId) : undefined)).orderBy(desc(s.users.createdAt), desc(s.users.id)).limit(limit); break;
        case 'organizations': rows = await tx.select({ id: s.organizations.id, name: s.organizations.name, createdAt: s.organizations.createdAt }).from(s.organizations).where(scope(s.organizations, s.organizations.id)).orderBy(desc(s.organizations.createdAt), desc(s.organizations.id)).limit(limit); break;
        case 'jobs': case 'failed_jobs': rows = await tx.select({ id: s.jobs.id, tenantId: s.jobs.tenantId, type: s.jobs.type, status: s.jobs.status, progress: s.jobs.progress, provider: s.jobs.provider, model: s.jobs.model, attempt: s.jobs.attempt, errorCode: s.jobs.errorCode, correlationId: s.jobs.correlationId, createdAt: s.jobs.createdAt }).from(s.jobs).where(scope(s.jobs, s.jobs.tenantId, input.category === 'failed_jobs' ? inArray(s.jobs.status, ['FAILED', 'RECONCILIATION']) : undefined)).orderBy(desc(s.jobs.createdAt), desc(s.jobs.id)).limit(limit); break;
        case 'subscriptions': rows = await tx.select({ id: s.subscriptionTerms.id, tenantId: s.subscriptionTerms.tenantId, subscriptionId: s.subscriptionTerms.subscriptionId, planVersionId: s.subscriptionTerms.planVersionId, startsAt: s.subscriptionTerms.startsAt, endsAt: s.subscriptionTerms.endsAt, createdAt: s.subscriptionTerms.createdAt }).from(s.subscriptionTerms).where(scope(s.subscriptionTerms, s.subscriptionTerms.tenantId)).orderBy(desc(s.subscriptionTerms.createdAt), desc(s.subscriptionTerms.id)).limit(limit); break;
        case 'plans': rows = await tx.select({ id: s.planVersions.id, code: s.plans.code, name: s.plans.name, enabled: s.plans.enabled, version: s.planVersions.version, amountMinor: s.planVersions.amountMinor, currency: s.planVersions.currency, aiCredits: s.planVersions.aiCredits, videoSeconds: s.planVersions.videoSeconds, createdAt: s.planVersions.createdAt }).from(s.planVersions).innerJoin(s.plans, eq(s.plans.id, s.planVersions.planId)).where(scope(s.planVersions)).orderBy(desc(s.planVersions.createdAt), desc(s.planVersions.id)).limit(limit); break;
        case 'usage': rows = await tx.select({ id: s.usageLedger.id, tenantId: s.usageLedger.tenantId, unit: s.usageLedger.unit, type: s.usageLedger.type, amount: s.usageLedger.amount, availableDelta: s.usageLedger.availableDelta, reservedDelta: s.usageLedger.reservedDelta, correlationId: s.usageLedger.correlationId, createdAt: s.usageLedger.createdAt }).from(s.usageLedger).where(scope(s.usageLedger, s.usageLedger.tenantId)).orderBy(desc(s.usageLedger.createdAt), desc(s.usageLedger.id)).limit(limit); break;
        case 'webhooks': rows = await tx.select({ id: s.webhookEvents.id, provider: s.webhookEvents.provider, eventType: s.webhookEvents.eventType, status: s.webhookEvents.status, attempt: s.webhookEvents.attempt, errorCode: s.webhookEvents.errorCode, correlationId: s.webhookEvents.correlationId, createdAt: s.webhookEvents.createdAt }).from(s.webhookEvents).where(scope(s.webhookEvents)).orderBy(desc(s.webhookEvents.createdAt), desc(s.webhookEvents.id)).limit(limit); break;
        case 'social': rows = await tx.select({ id: s.socialConnections.id, tenantId: s.socialConnections.tenantId, brandId: s.socialConnections.brandId, provider: s.socialConnections.provider, name: s.socialConnections.name, status: s.socialConnections.status, lastCheckedAt: s.socialConnections.lastCheckedAt, errorCode: s.socialConnections.errorCode, createdAt: s.socialConnections.createdAt }).from(s.socialConnections).where(scope(s.socialConnections, s.socialConnections.tenantId)).orderBy(desc(s.socialConnections.createdAt), desc(s.socialConnections.id)).limit(limit); break;
        case 'costs': rows = await tx.select({ id: s.aiCalls.id, tenantId: s.aiCalls.tenantId, jobId: s.aiCalls.jobId, provider: s.aiCalls.provider, model: s.aiCalls.model, status: s.aiCalls.status, inputUnits: s.aiCalls.inputUnits, outputUnits: s.aiCalls.outputUnits, costMicrounits: s.aiCalls.providerCostMicrounits, currency: s.aiCalls.currency, durationMs: s.aiCalls.durationMs, createdAt: s.aiCalls.createdAt }).from(s.aiCalls).where(scope(s.aiCalls, s.aiCalls.tenantId)).orderBy(desc(s.aiCalls.createdAt), desc(s.aiCalls.id)).limit(limit); break;
        case 'feature_flags': rows = await tx.select({ id: s.featureFlags.id, tenantId: s.featureFlags.tenantId, name: s.featureFlags.name, enabled: s.featureFlags.enabled, revision: s.featureFlags.revision, createdAt: s.featureFlags.updatedAt }).from(s.featureFlags).where(scope({ id: s.featureFlags.id, createdAt: s.featureFlags.updatedAt }, s.featureFlags.tenantId)).orderBy(desc(s.featureFlags.updatedAt), desc(s.featureFlags.id)).limit(limit); break;
        case 'audit': rows = await tx.select({ id: s.auditLogs.id, tenantId: s.auditLogs.tenantId, actorId: s.auditLogs.userId, action: s.auditLogs.action, resourceId: s.auditLogs.resourceId, correlationId: s.auditLogs.correlationId, createdAt: s.auditLogs.createdAt }).from(s.auditLogs).where(scope(s.auditLogs, s.auditLogs.tenantId)).orderBy(desc(s.auditLogs.createdAt), desc(s.auditLogs.id)).limit(limit); break;
        case 'email': rows = await tx.select({ id: s.emailOutbox.id, userId: s.emailOutbox.userId, status: s.emailOutbox.status, attempt: s.emailOutbox.attempt, errorCode: s.emailOutbox.errorCode, correlationId: s.emailOutbox.correlationId, createdAt: s.emailOutbox.createdAt }).from(s.emailOutbox).where(scope(s.emailOutbox)).orderBy(desc(s.emailOutbox.createdAt), desc(s.emailOutbox.id)).limit(limit); break;
        case 'payment_tasks': rows = await tx.select({ id: s.paymentTasks.id, tenantId: s.paymentTasks.tenantId, status: s.paymentTasks.status, attempt: s.paymentTasks.attempt, submissionCount: s.paymentTasks.submissionCount, errorCode: s.paymentTasks.errorCode, createdAt: s.paymentTasks.createdAt }).from(s.paymentTasks).where(scope(s.paymentTasks, s.paymentTasks.tenantId)).orderBy(desc(s.paymentTasks.createdAt), desc(s.paymentTasks.id)).limit(limit); break;
        case 'deletion_requests': rows = await tx.select({ id: s.accountDeletionRequests.id, userId: s.accountDeletionRequests.userId, status: s.accountDeletionRequests.status, cancelledAt: s.accountDeletionRequests.cancelledAt, createdAt: s.accountDeletionRequests.createdAt }).from(s.accountDeletionRequests).where(scope(s.accountDeletionRequests)).orderBy(desc(s.accountDeletionRequests.createdAt), desc(s.accountDeletionRequests.id)).limit(limit); break;
        case 'actions': rows = await tx.select({ id: s.platformActions.id, actorId: s.platformActions.actorId, userId: s.platformActions.targetUserId, operation: s.platformActions.operation, reason: s.platformActions.reason, ticket: s.platformActions.ticket, revokedSessions: s.platformActions.revokedSessions, createdAt: s.platformActions.createdAt }).from(s.platformActions).where(scope(s.platformActions)).orderBy(desc(s.platformActions.createdAt), desc(s.platformActions.id)).limit(limit); break;
      }
      await tx.insert(s.auditLogs).values({ userId, action: 'ADMIN_DATA_READ', correlationId, metadata: { category: input.category, ...(input.tenantId ? { tenantId: input.tenantId } : {}) } });
      const more = rows.length > input.limit;
      const page = rows.slice(0, input.limit), last = page.at(-1);
      return { role: operator.role, rows: page, next: more && last ? { beforeAt: (last.createdAt as Date).toISOString(), beforeId: String(last.id) } : null };
    });
  }
  async catalog(userId: string, correlationId: string) {
    return this.db.transaction(async tx => {
      const operator = await assertPlatformOperator(tx, userId);
      const rows = await tx.selectDistinctOn([s.plans.id], {
        code: s.plans.code, name: s.plans.name, enabled: s.plans.enabled,
        version: sql<number>`coalesce(${s.planVersions.version}, 0)`, planVersionId: s.planVersions.id,
        amountMinor: sql<number>`coalesce(${s.planVersions.amountMinor}, 0)`, currency: sql<string>`coalesce(${s.planVersions.currency}, 'RUB')`,
        aiCredits: sql<number>`coalesce(${s.planVersions.aiCredits}, 0)`, videoSeconds: sql<number>`coalesce(${s.planVersions.videoSeconds}, 0)`,
      }).from(s.plans).leftJoin(s.planVersions, eq(s.planVersions.planId, s.plans.id)).orderBy(s.plans.id, desc(s.planVersions.version));
      await tx.insert(s.auditLogs).values({ userId, action: 'ADMIN_CATALOG_READ', correlationId });
      return { role: operator.role, plans: rows };
    });
  }
  async publishPlan(userId: string, input: AdminPlanInput, correlationId: string) {
    const { idempotencyKey, ...intent } = input;
    const hash = createHash('sha256').update(JSON.stringify(intent)).digest('hex');
    return this.db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`platform-pricing:${userId}`}, 0))`);
      if ((await assertPlatformOperator(tx, userId)).role !== 'ADMIN') throw new DomainError('NOT_AUTHORIZED', 403);
      const [existing] = await tx.select().from(s.platformPlanChanges).where(and(eq(s.platformPlanChanges.actorId, userId), eq(s.platformPlanChanges.requestKey, idempotencyKey)));
      if (existing) {
        if (existing.inputHash !== hash) throw new DomainError('CONFLICT', 409);
        return { id: existing.id, planVersionId: existing.planVersionId };
      }
      // Checkout shares this lock; a published version and its availability become visible together.
      const [plan] = await tx.select().from(s.plans).where(eq(s.plans.code, input.code)).for('update');
      if (!plan) throw new DomainError('NOT_FOUND', 404);
      const [latest] = await tx.select({ version: s.planVersions.version }).from(s.planVersions).where(eq(s.planVersions.planId, plan.id)).orderBy(desc(s.planVersions.version)).limit(1);
      if ((latest?.version ?? 0) !== input.expectedVersion) throw new DomainError('CONFLICT', 409);
      const [version] = await tx.insert(s.planVersions).values({ planId: plan.id, version: input.expectedVersion + 1, amountMinor: input.amountMinor, currency: input.currency, aiCredits: input.aiCredits, videoSeconds: input.videoSeconds }).returning({ id: s.planVersions.id });
      if (!version) throw new Error('Plan version insert failed');
      await tx.update(s.plans).set({ name: input.name, enabled: input.enabled }).where(eq(s.plans.id, plan.id));
      const [change] = await tx.insert(s.platformPlanChanges).values({ actorId: userId, planVersionId: version.id, name: input.name, enabled: input.enabled, ticket: input.ticket, requestKey: idempotencyKey, inputHash: hash }).returning({ id: s.platformPlanChanges.id, planVersionId: s.platformPlanChanges.planVersionId });
      if (!change) throw new Error('Plan change insert failed');
      await tx.insert(s.auditLogs).values({ userId, action: 'ADMIN_PLAN_PUBLISHED', resourceId: version.id, correlationId, metadata: { changeId: change.id, code: input.code, version: input.expectedVersion + 1, ticket: input.ticket, enabled: input.enabled } });
      return change;
    });
  }
  async revokeSessions(userId: string, input: AdminRevokeSessionsInput, correlationId: string) {
    const hash = createHash('sha256').update(JSON.stringify({ userId: input.userId, reason: input.reason, ticket: input.ticket })).digest('hex');
    return this.db.transaction(async tx => {
      // Serialize operator support intents before reading permissions and target locks.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`platform-action:${userId}`}, 0))`);
      await assertPlatformOperator(tx, userId);
      const [existing] = await tx.select().from(s.platformActions).where(and(eq(s.platformActions.actorId, userId), eq(s.platformActions.requestKey, input.idempotencyKey)));
      if (existing) { if (existing.inputHash !== hash) throw new DomainError('CONFLICT', 409); return { id: existing.id, revokedSessions: existing.revokedSessions }; }
      // Operator accounts use their own security flow; support cannot target an operator.
      const [protectedAccount] = await tx.select({ id: s.platformOperators.id }).from(s.platformOperators).where(eq(s.platformOperators.userId, input.userId));
      if (protectedAccount || userId === input.userId) throw new DomainError('NOT_AUTHORIZED', 403);
      const [target] = await tx.select({ id: s.users.id }).from(s.users).where(eq(s.users.id, input.userId)).for('update');
      if (!target) throw new DomainError('NOT_FOUND', 404);
      const [newlyProtected] = await tx.select({ id: s.platformOperators.id }).from(s.platformOperators).where(eq(s.platformOperators.userId, input.userId));
      if (newlyProtected) throw new DomainError('NOT_AUTHORIZED', 403);
      const revoked = await tx.delete(s.sessions).where(eq(s.sessions.userId, input.userId)).returning({ id: s.sessions.id });
      const [action] = await tx.insert(s.platformActions).values({ actorId: userId, targetUserId: input.userId, operation: 'REVOKE_SESSIONS', reason: input.reason, ticket: input.ticket, requestKey: input.idempotencyKey, inputHash: hash, revokedSessions: revoked.length }).returning({ id: s.platformActions.id, revokedSessions: s.platformActions.revokedSessions });
      if (!action) throw new Error('Platform action insert failed');
      await tx.insert(s.auditLogs).values({ userId, resourceId: input.userId, action: 'ADMIN_SESSIONS_REVOKED', correlationId, metadata: { actionId: action.id, reason: input.reason, ticket: input.ticket, revokedSessions: revoked.length } });
      return action;
    });
  }
}
