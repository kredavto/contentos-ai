import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, isNull, isNotNull, sql } from 'drizzle-orm';
import { DomainError } from '@contentos/types';
import type { Database } from '../index';
import { accountDeletionRequests, auditLogs, authTokens, emailOutbox, consentRecords, renewalConsents, organizations, organizationMembers, sessions, users } from '../schema';
const projection = { id: accountDeletionRequests.id, status: accountDeletionRequests.status, revision: accountDeletionRequests.revision, createdAt: accountDeletionRequests.createdAt, cancelledAt: accountDeletionRequests.cancelledAt };
export class PrivacyRepository {
  constructor(private readonly db: Database) {}
  async passwordProof(userId: string) {
    const [user] = await this.db.select({ passwordHash: users.passwordHash }).from(users).where(and(eq(users.id, userId), isNull(users.disabledAt), isNotNull(users.emailVerifiedAt)));
    if (!user) throw new DomainError('NOT_AUTHORIZED', 403);
    return user.passwordHash;
  }
  async overview(userId: string) {
    return this.db.transaction(async tx => {
      const [user] = await tx.select({ id: users.id, name: users.name, email: users.email, verifiedAt: users.emailVerifiedAt }).from(users).where(and(eq(users.id, userId), isNull(users.disabledAt))).for('share');
      if (!user) throw new DomainError('NOT_AUTHORIZED', 403);
      const [active] = await tx.select({ count: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())));
      const ownedOrganizations = await tx.select({ id: organizations.id, name: organizations.name }).from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.tenantId)).where(and(eq(organizationMembers.userId, userId), eq(organizationMembers.role, 'OWNER'))).orderBy(organizations.name);
      const requests = await tx.select(projection).from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, userId)).orderBy(desc(accountDeletionRequests.createdAt), desc(accountDeletionRequests.id)).limit(20);
      return { user, activeSessions: active?.count ?? 0, ownedOrganizations, requests };
    });
  }
  async exportAccount(userId: string, passwordHash: string, correlationId: string) {
    return this.db.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      const [profile] = await tx.select({ id: users.id, name: users.name, email: users.email, emailVerifiedAt: users.emailVerifiedAt, createdAt: users.createdAt }).from(users).where(and(eq(users.id, userId), eq(users.passwordHash, passwordHash), isNull(users.disabledAt), isNotNull(users.emailVerifiedAt))).for('share');
      if (!profile) throw new DomainError('NOT_AUTHORIZED', 403);
      // Explicit projections: neither credentials nor other members' personal data enter the archive.
      const memberships = await tx.select({ organizationId: organizationMembers.tenantId, role: organizationMembers.role, joinedAt: organizationMembers.createdAt }).from(organizationMembers).where(eq(organizationMembers.userId, userId)).orderBy(organizationMembers.tenantId).limit(10001);
      const sessionHistory = await tx.select({ createdAt: sessions.createdAt, expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.userId, userId)).orderBy(sessions.createdAt, sessions.id).limit(10001);
      const deletionRequests = await tx.select(projection).from(accountDeletionRequests).where(eq(accountDeletionRequests.userId, userId)).orderBy(accountDeletionRequests.createdAt, accountDeletionRequests.id).limit(10001);
      const authenticationHistory = await tx.select({ type: authTokens.type, createdAt: authTokens.createdAt, expiresAt: authTokens.expiresAt, consumedAt: authTokens.consumedAt }).from(authTokens).where(eq(authTokens.userId, userId)).orderBy(authTokens.createdAt, authTokens.id).limit(10001);
      const emailHistory = await tx.select({ status: emailOutbox.status, attempts: emailOutbox.attempt, createdAt: emailOutbox.createdAt, completedAt: emailOutbox.completedAt }).from(emailOutbox).where(eq(emailOutbox.userId, userId)).orderBy(emailOutbox.createdAt, emailOutbox.id).limit(10001);
      // Account evidence belongs to the actor even after membership ends. Do not join tenant content.
      const acceptedConsents = await tx.select({ id: consentRecords.id, type: consentRecords.consentType, version: consentRecords.consentVersion, textHash: consentRecords.consentTextHash, acceptedAt: consentRecords.acceptedAt, ipAddress: consentRecords.ipAddress, userAgent: consentRecords.userAgent, revokedAt: consentRecords.revokedAt }).from(consentRecords).where(eq(consentRecords.acceptedByUserId, userId)).orderBy(consentRecords.acceptedAt, consentRecords.id).limit(10001);
      // A revoker does not receive the original acceptor's identity, IP or user agent.
      const consentRevocations = await tx.select({ id: consentRecords.id, type: consentRecords.consentType, revokedAt: consentRecords.revokedAt }).from(consentRecords).where(eq(consentRecords.revokedByUserId, userId)).orderBy(consentRecords.revokedAt, consentRecords.id).limit(10001);
      const renewalConsentHistory = await tx.select({ id: renewalConsents.id, policyVersion: renewalConsents.policyVersion, policyText: renewalConsents.policyText, textHash: renewalConsents.textHash, amountMinor: renewalConsents.amountMinor, currency: renewalConsents.currency, acceptedAt: renewalConsents.createdAt, ipAddress: renewalConsents.ipAddress, userAgent: renewalConsents.userAgent }).from(renewalConsents).where(eq(renewalConsents.acceptedBy, userId)).orderBy(renewalConsents.createdAt, renewalConsents.id).limit(10001);
      const activityHistory = await tx.select({ action: auditLogs.action, createdAt: auditLogs.createdAt }).from(auditLogs).where(eq(auditLogs.userId, userId)).orderBy(auditLogs.createdAt, auditLogs.id).limit(10001);
      if ([memberships, sessionHistory, deletionRequests, authenticationHistory, emailHistory, acceptedConsents, consentRevocations, renewalConsentHistory, activityHistory].some(rows => rows.length > 10000)) throw new DomainError('EXPORT_TOO_LARGE', 413);
      const archive = { format: 'contentos-account', version: 2, generatedAt: new Date().toISOString(), scope: ['profile', 'current_memberships', 'retained_session_metadata', 'deletion_requests', 'authentication_history', 'email_delivery_metadata', 'accepted_consent_evidence', 'own_consent_revocations', 'renewal_consent_evidence', 'own_activity_metadata'], excluded: ['credentials', 'email_content', 'organization_content_and_media', 'payment_transactions', 'third_party_identities', 'operational_payloads'], profile, memberships, sessionHistory, deletionRequests, authenticationHistory, emailHistory, acceptedConsents, consentRevocations, renewalConsentHistory, activityHistory };
      // Fail explicitly instead of silently truncating or exceeding the deployment response limit.
      if (Buffer.byteLength(JSON.stringify(archive), 'utf8') > 2 * 1024 * 1024) throw new DomainError('EXPORT_TOO_LARGE', 413);
      await tx.insert(auditLogs).values({ userId, action: 'ACCOUNT_DATA_EXPORTED', resourceId: userId, correlationId });
      return archive;
    }, { isolationLevel: 'repeatable read' });
  }
  async request(userId: string, passwordHash: string, requestKey: string, correlationId: string) {
    return this.db.transaction(async tx => {
      // Serialize with password reset/disable and with all other requests for this account.
      const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.passwordHash, passwordHash), isNull(users.disabledAt), isNotNull(users.emailVerifiedAt))).for('update');
      if (!user) throw new DomainError('NOT_AUTHORIZED', 403);
      const [existing] = await tx.select(projection).from(accountDeletionRequests).where(and(eq(accountDeletionRequests.userId, userId), eq(accountDeletionRequests.requestKey, requestKey)));
      if (existing) return existing;
      const [active] = await tx.select(projection).from(accountDeletionRequests).where(and(eq(accountDeletionRequests.userId, userId), eq(accountDeletionRequests.status, 'REQUESTED')));
      if (active) throw new DomainError('CONFLICT', 409);
      const [request] = await tx.insert(accountDeletionRequests).values({ userId, requestKey }).returning(projection);
      if (!request) throw new Error('Deletion request insert failed');
      await tx.insert(auditLogs).values({ userId, action: 'ACCOUNT_DELETION_REQUESTED', resourceId: request.id, correlationId });
      return request;
    });
  }
  async cancel(userId: string, requestId: string, revision: string, correlationId: string) {
    return this.db.transaction(async tx => {
      const [user] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.disabledAt))).for('update');
      if (!user) throw new DomainError('NOT_AUTHORIZED', 403);
      const [request] = await tx.select(projection).from(accountDeletionRequests).where(and(eq(accountDeletionRequests.id, requestId), eq(accountDeletionRequests.userId, userId))).for('update');
      if (!request) throw new DomainError('NOT_FOUND', 404);
      if (request.status === 'CANCELLED') return request;
      if (request.revision !== revision) throw new DomainError('CONFLICT', 409);
      const [result] = await tx.update(accountDeletionRequests).set({ status: 'CANCELLED', cancelledAt: sql`greatest(now(), ${accountDeletionRequests.createdAt})`, revision: randomUUID() }).where(eq(accountDeletionRequests.id, requestId)).returning(projection);
      if (!result) throw new Error('Deletion request update failed');
      await tx.insert(auditLogs).values({ userId, action: 'ACCOUNT_DELETION_CANCELLED', resourceId: requestId, correlationId });
      return result;
    });
  }
}
