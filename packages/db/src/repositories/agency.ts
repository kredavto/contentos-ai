import { createHash, randomUUID } from 'node:crypto';
import { and, eq, desc, sql } from 'drizzle-orm';
import { DomainError, type AgencyClientInput } from '@contentos/types';
import type { Database } from '../index';
import { agencyClients, featureFlags, organizations, organizationMembers, workspaces, auditLogs } from '../schema';
import { assertMembership, lockTenant, type Transaction } from './ledger';
async function agencyMember(tx: Transaction, userId: string, tenantId: string, write = false) {
  const member = await assertMembership(tx, userId, tenantId, write ? 'strategy' : 'read');
  if (!(write ? ['OWNER', 'ADMIN'] : ['OWNER', 'ADMIN', 'MANAGER']).includes(member.role)) throw new DomainError('NOT_AUTHORIZED', 403);
  return member;
}
async function mode(tx: Transaction, tenantId: string) {
  const [flag] = await tx.select().from(featureFlags).where(and(eq(featureFlags.tenantId, tenantId), eq(featureFlags.name, 'agency_mode')));
  return { enabled: flag?.enabled ?? false, revision: flag?.revision ?? 0 };
}
export class AgencyRepository {
  constructor(private readonly db: Database) {}
  async overview(userId: string, tenantId: string) {
    return this.db.transaction(async tx => {
      const member = await agencyMember(tx, userId, tenantId);
      const settings = await mode(tx, tenantId);
      // An agency relation never substitutes for membership in the client tenant.
      const clients = settings.enabled ? await tx.select({ id: agencyClients.id, organizationId: organizations.id, name: organizations.name, role: organizationMembers.role, revision: agencyClients.revision, archivedAt: agencyClients.archivedAt, createdAt: agencyClients.createdAt }).from(agencyClients)
        .innerJoin(organizations, eq(organizations.id, agencyClients.clientOrganizationId))
        .innerJoin(organizationMembers, and(eq(organizationMembers.tenantId, organizations.id), eq(organizationMembers.userId, userId)))
        .where(eq(agencyClients.tenantId, tenantId)).orderBy(desc(agencyClients.createdAt)).limit(200) : [];
      return { ...settings, role: member.role, clients };
    });
  }
  async setMode(userId: string, tenantId: string, enabled: boolean, revision: number, correlationId: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'billing');
      const current = await mode(tx, tenantId);
      if (current.revision !== revision) throw new DomainError('CONFLICT', 409);
      const updated = { enabled, revision: revision + 1 };
      await tx.insert(featureFlags).values({ tenantId, name: 'agency_mode', ...updated }).onConflictDoUpdate({ target: [featureFlags.tenantId, featureFlags.name], set: { ...updated, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ tenantId, userId, action: 'AGENCY_MODE_UPDATED', correlationId, metadata: updated });
      return updated;
    });
  }
  async addClient(userId: string, tenantId: string, input: AgencyClientInput, correlationId: string) {
    const hash = createHash('sha256').update(JSON.stringify(input.kind === 'CREATE' ? { kind: input.kind, name: input.name, timezone: input.timezone } : { kind: input.kind, organizationId: input.organizationId })).digest('hex');
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await agencyMember(tx, userId, tenantId, true);
      if (!(await mode(tx, tenantId)).enabled) throw new DomainError('NOT_AUTHORIZED', 403);
      const [existing] = await tx.select().from(agencyClients).where(and(eq(agencyClients.tenantId, tenantId), eq(agencyClients.requestKey, input.idempotencyKey)));
      if (existing) {
        if (existing.createdBy !== userId || existing.intentHash !== hash) throw new DomainError('CONFLICT', 409);
        await assertMembership(tx, userId, existing.clientOrganizationId);
        return { id: existing.id, organizationId: existing.clientOrganizationId, revision: existing.revision, archivedAt: existing.archivedAt };
      }
      const [count] = await tx.select({ value: sql<number>`count(*)::integer` }).from(agencyClients).where(eq(agencyClients.tenantId, tenantId));
      if ((count?.value ?? 0) >= 200) throw new DomainError('PORTFOLIO_LIMIT_REACHED', 409);
      let clientId: string;
      if (input.kind === 'LINK') {
        if (input.organizationId === tenantId) throw new DomainError('INVALID_INPUT');
        await assertMembership(tx, userId, input.organizationId, 'billing');
        const [linked] = await tx.select({ id: agencyClients.id }).from(agencyClients).where(and(eq(agencyClients.tenantId, tenantId), eq(agencyClients.clientOrganizationId, input.organizationId)));
        if (linked) throw new DomainError('CONFLICT', 409);
        clientId = input.organizationId;
      } else {
        clientId = randomUUID();
        await tx.insert(organizations).values({ id: clientId, name: input.name });
        await tx.insert(organizationMembers).values({ tenantId: clientId, userId, role: 'OWNER' });
        await tx.insert(workspaces).values({ tenantId: clientId, name: 'Основное пространство', timezone: input.timezone });
        await tx.insert(auditLogs).values({ tenantId: clientId, userId, resourceId: clientId, action: 'ORGANIZATION_CREATED', correlationId });
      }
      const [client] = await tx.insert(agencyClients).values({ tenantId, clientOrganizationId: clientId, createdBy: userId, requestKey: input.idempotencyKey, intentHash: hash }).returning();
      if (!client) throw new Error('Agency client insert failed');
      await tx.insert(auditLogs).values({ tenantId, userId, resourceId: client.id, action: 'AGENCY_CLIENT_ADDED', correlationId });
      return { id: client.id, organizationId: clientId, revision: client.revision, archivedAt: client.archivedAt };
    });
  }
  async setArchived(userId: string, tenantId: string, clientId: string, revision: string, archived: boolean, correlationId: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await agencyMember(tx, userId, tenantId, true);
      if (!(await mode(tx, tenantId)).enabled) throw new DomainError('NOT_AUTHORIZED', 403);
      const scope = and(eq(agencyClients.tenantId, tenantId), eq(agencyClients.id, clientId));
      const [client] = await tx.select().from(agencyClients).where(scope).for('update');
      if (!client) throw new DomainError('NOT_FOUND', 404);
      await assertMembership(tx, userId, client.clientOrganizationId, archived ? 'read' : 'billing');
      if (client.revision !== revision) throw new DomainError('CONFLICT', 409);
      const [updated] = await tx.update(agencyClients).set({ archivedAt: archived ? new Date() : null, revision: randomUUID() }).where(scope).returning({ id: agencyClients.id, revision: agencyClients.revision });
      await tx.insert(auditLogs).values({ tenantId, userId, resourceId: clientId, action: archived ? 'AGENCY_CLIENT_ARCHIVED' : 'AGENCY_CLIENT_RESTORED', correlationId });
      return updated;
    });
  }
}
