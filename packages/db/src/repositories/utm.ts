import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, isNotNull, lt } from 'drizzle-orm';
import { DomainError, type UtmCreate, type UtmList } from '@contentos/types';
import type { Database } from '../index';
import { utmLinks, brands, auditLogs } from '../schema';
import { assertMembership, lockTenant, type Transaction } from './ledger';
const projection = { id: utmLinks.id, name: utmLinks.name, destinationUrl: utmLinks.destinationUrl, taggedUrl: utmLinks.taggedUrl, source: utmLinks.source, medium: utmLinks.medium, campaign: utmLinks.campaign, term: utmLinks.term, content: utmLinks.content, revision: utmLinks.revision, archivedAt: utmLinks.archivedAt, createdAt: utmLinks.createdAt };
async function ownedBrand(tx: Transaction, tenantId: string, brandId: string) {
  const [brand] = await tx.select({ id: brands.id }).from(brands).where(and(eq(brands.tenantId, tenantId), eq(brands.id, brandId)));
  if (!brand) throw new DomainError('NOT_FOUND', 404);
}
export class UtmRepository {
  constructor(private readonly db: Database) {}
  async list(userId: string, tenantId: string, brandId: string, input: UtmList) {
    return this.db.transaction(async tx => {
      await assertMembership(tx, userId, tenantId); await ownedBrand(tx, tenantId, brandId);
      const rows = await tx.select(projection).from(utmLinks).where(and(eq(utmLinks.tenantId, tenantId), eq(utmLinks.brandId, brandId), input.status === 'ACTIVE' ? isNull(utmLinks.archivedAt) : isNotNull(utmLinks.archivedAt), input.before ? lt(utmLinks.id, input.before) : undefined)).orderBy(desc(utmLinks.id)).limit(51);
      return { rows: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null };
    });
  }
  async create(userId: string, tenantId: string, brandId: string, input: UtmCreate, taggedUrl: string, correlationId: string) {
    const inputHash = createHash('sha256').update(JSON.stringify({ brandId, ...input })).digest('hex');
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'generate'); await ownedBrand(tx, tenantId, brandId);
      const [existing] = await tx.select({ ...projection, inputHash: utmLinks.inputHash, createdBy: utmLinks.createdBy }).from(utmLinks).where(and(eq(utmLinks.tenantId, tenantId), eq(utmLinks.idempotencyKey, input.idempotencyKey)));
      if (existing) {
        if (existing.inputHash !== inputHash || existing.createdBy !== userId) throw new DomainError('CONFLICT', 409);
        const { inputHash: _hash, createdBy: _actor, ...safe } = existing; return safe;
      }
      const [result] = await tx.insert(utmLinks).values({ ...input, tenantId, brandId, taggedUrl, inputHash, createdBy: userId }).returning(projection);
      if (!result) throw new Error('UTM link insert failed');
      await tx.insert(auditLogs).values({ tenantId, userId, action: 'UTM_LINK_CREATED', resourceId: result.id, correlationId });
      return result;
    });
  }
  async archive(userId: string, tenantId: string, brandId: string, id: string, revision: number, archived: boolean, correlationId: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId); await assertMembership(tx, userId, tenantId, 'generate');
      const filter = and(eq(utmLinks.tenantId, tenantId), eq(utmLinks.brandId, brandId), eq(utmLinks.id, id));
      const [link] = await tx.select(projection).from(utmLinks).where(filter);
      if (!link) throw new DomainError('NOT_FOUND', 404);
      if (!!link.archivedAt === archived) return link;
      if (link.revision !== revision) throw new DomainError('CONFLICT', 409);
      const [result] = await tx.update(utmLinks).set({ archivedAt: archived ? new Date() : null, revision: revision + 1 }).where(filter).returning(projection);
      if (!result) throw new Error('UTM link update failed');
      await tx.insert(auditLogs).values({ tenantId, userId, action: archived ? 'UTM_LINK_ARCHIVED' : 'UTM_LINK_RESTORED', resourceId: id, correlationId });
      return result;
    });
  }
}
