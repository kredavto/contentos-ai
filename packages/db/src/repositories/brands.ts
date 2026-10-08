import { and, eq } from 'drizzle-orm';
import { DomainError, emptyOnboarding, onboardingSchema, type Role, type OnboardingSave, type BrandProfileSave } from '@contentos/types';
import { assertMembership, lockTenant } from './ledger';
import type { Database } from '../index';
import * as s from '../schema';
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const brainTables = { products: s.products, audience: s.audienceSegments, pains: s.painPoints, competitors: s.competitors, ctas: s.ctas, leadMagnets: s.leadMagnets, references: s.referenceContent } as const;
export class BrandRepository {
  constructor(private readonly db: Database) {}
  private async member(tx: Tx, userId: string, tenantId: string, allowedRoles?: readonly Role[]) {
    const [member] = await tx.select().from(s.organizationMembers).where(and(eq(s.organizationMembers.userId, userId), eq(s.organizationMembers.tenantId, tenantId))).for('share');
    if (!member) throw new DomainError('NOT_FOUND', 404);
    if (allowedRoles && !allowedRoles.includes(member.role)) throw new DomainError('NOT_AUTHORIZED', 403);
    return member;
  }
  async listOrganizations(userId: string) {
    return this.db.select({ id: s.organizations.id, name: s.organizations.name, role: s.organizationMembers.role })
      .from(s.organizations).innerJoin(s.organizationMembers, eq(s.organizationMembers.tenantId, s.organizations.id)).where(eq(s.organizationMembers.userId, userId));
  }
  async createOrganization(userId: string, name: string, timezone: string, correlationId: string) {
    return this.db.transaction(async tx => {
      const [organization] = await tx.insert(s.organizations).values({ name }).returning();
      if (!organization) throw new Error('Organization insert failed');
      await tx.insert(s.organizationMembers).values({ userId, tenantId: organization.id, role: 'OWNER' });
      await tx.insert(s.workspaces).values({ tenantId: organization.id, name: 'Основное пространство', timezone });
      await tx.insert(s.auditLogs).values({ userId, tenantId: organization.id, resourceId: organization.id, action: 'ORGANIZATION_CREATED', correlationId });
      return organization;
    });
  }
  async overview(userId: string, tenantId: string) {
    return this.db.transaction(async tx => {
      const membership = await this.member(tx, userId, tenantId);
      const workspaces = await tx.select().from(s.workspaces).where(eq(s.workspaces.tenantId, tenantId));
      const brands = await tx.select().from(s.brands).where(eq(s.brands.tenantId, tenantId));
      return { role: membership.role, workspaces, brands };
    });
  }
  async createBrand(userId: string, tenantId: string, workspaceId: string, name: string, allowedRoles: readonly Role[], correlationId: string) {
    return this.db.transaction(async tx => {
      await this.member(tx, userId, tenantId, allowedRoles);
      const [workspace] = await tx.select().from(s.workspaces).where(and(eq(s.workspaces.tenantId, tenantId), eq(s.workspaces.id, workspaceId)));
      if (!workspace) throw new DomainError('NOT_FOUND', 404);
      const [brand] = await tx.insert(s.brands).values({ tenantId, workspaceId, name }).returning();
      if (!brand) throw new Error('Brand insert failed');
      await tx.insert(s.brandProfiles).values({ tenantId, brandId: brand.id });
      await tx.insert(s.auditLogs).values({ userId, tenantId, resourceId: brand.id, action: 'BRAND_CREATED', correlationId });
      return brand;
    });
  }
  async getBrandBrain(userId: string, tenantId: string, brandId: string) {
    return this.db.transaction(async tx => {
      const membership = await this.member(tx, userId, tenantId);
      const scope = and(eq(s.brands.tenantId, tenantId), eq(s.brands.id, brandId));
      const [brand] = await tx.select().from(s.brands).where(scope).for('share');
      if (!brand) throw new DomainError('NOT_FOUND', 404);
      const [profile] = await tx.select().from(s.brandProfiles).where(and(eq(s.brandProfiles.tenantId, tenantId), eq(s.brandProfiles.brandId, brandId)));
      const data = emptyOnboarding(brand.name);
      Object.assign(data, { website: profile?.website ?? '', niche: profile?.niche ?? '', geography: profile?.geography ?? '', usp: profile?.usp ?? '', goals: profile?.goals ?? [], platforms: profile?.socialPlatforms ?? [] });
      for (const [key, table] of Object.entries(brainTables)) {
        const rows = await tx.select({ name: table.name, description: table.description }).from(table).where(and(eq(table.tenantId, tenantId), eq(table.brandId, brandId)));
        Object.assign(data, { [key]: rows });
      }
      const [voice] = await tx.select().from(s.brandVoice).where(and(eq(s.brandVoice.tenantId, tenantId), eq(s.brandVoice.brandId, brandId)));
      data.voice = voice?.description ?? '';
      return { brand, data: onboardingSchema.parse(data), role: membership.role };
    });
  }
  async saveOnboarding(userId: string, tenantId: string, brandId: string, input: OnboardingSave, allowedRoles: readonly Role[], correlationId: string) {
    return this.db.transaction(async tx => {
      await this.member(tx, userId, tenantId, allowedRoles);
      const whereBrand = and(eq(s.brands.tenantId, tenantId), eq(s.brands.id, brandId));
      const [brand] = await tx.select().from(s.brands).where(whereBrand).for('update');
      if (!brand) throw new DomainError('NOT_FOUND', 404);
      if (brand.revision !== input.revision || brand.onboardingCompletedAt) throw new DomainError('CONFLICT', 409);
      const data = input.data;
      await tx.update(s.brandProfiles).set({ website: data.website, niche: data.niche, geography: data.geography, usp: data.usp, goals: data.goals, socialPlatforms: data.platforms, updatedAt: new Date() }).where(and(eq(s.brandProfiles.tenantId, tenantId), eq(s.brandProfiles.brandId, brandId)));
      // Draft lists have no downstream references. Once complete, this endpoint is immutable.
      for (const [key, table] of Object.entries(brainTables)) {
        await tx.delete(table).where(and(eq(table.tenantId, tenantId), eq(table.brandId, brandId)));
        const rows = data[key as keyof typeof brainTables];
        if (rows.length) await tx.insert(table).values(rows.map(row => ({ ...row, tenantId, brandId })));
      }
      await tx.delete(s.brandVoice).where(and(eq(s.brandVoice.tenantId, tenantId), eq(s.brandVoice.brandId, brandId)));
      if (data.voice) await tx.insert(s.brandVoice).values({ tenantId, brandId, name: 'Основной голос бренда', description: data.voice });
      const [updated] = await tx.update(s.brands).set({ name: data.company, revision: brand.revision + 1, onboardingStep: input.step, onboardingCompletedAt: input.complete ? new Date() : null }).where(whereBrand).returning();
      await tx.insert(s.auditLogs).values({ userId, tenantId, resourceId: brandId, action: input.complete ? 'BRAND_BRAIN_CREATED' : 'ONBOARDING_SAVED', correlationId, metadata: { step: input.step, revision: brand.revision + 1 } });
      return updated;
    });
  }
  async saveProfile(userId: string, tenantId: string, brandId: string, input: BrandProfileSave, correlationId: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx, tenantId);
      await assertMembership(tx, userId, tenantId, 'strategy');
      const scope = and(eq(s.brands.tenantId, tenantId), eq(s.brands.id, brandId));
      const [brand] = await tx.select().from(s.brands).where(scope).for('update');
      if (!brand) throw new DomainError('NOT_FOUND', 404);
      if (!brand.onboardingCompletedAt || brand.revision !== input.revision) throw new DomainError('CONFLICT', 409);
      const data = input.data;
      await tx.update(s.brandProfiles).set({ website: data.website, niche: data.niche, geography: data.geography, usp: data.usp, goals: data.goals, socialPlatforms: data.platforms, updatedAt: new Date() }).where(and(eq(s.brandProfiles.tenantId, tenantId), eq(s.brandProfiles.brandId, brandId)));
      // Keep the voice identity and all audience/product/pillar references stable.
      const voiceScope = and(eq(s.brandVoice.tenantId, tenantId), eq(s.brandVoice.brandId, brandId));
      const [voice] = await tx.select({ id: s.brandVoice.id }).from(s.brandVoice).where(voiceScope);
      if (voice) await tx.update(s.brandVoice).set({ description: data.voice }).where(and(voiceScope, eq(s.brandVoice.id, voice.id)));
      else await tx.insert(s.brandVoice).values({ tenantId, brandId, name: 'Основной голос бренда', description: data.voice });
      const [updated] = await tx.update(s.brands).set({ name: data.company, revision: brand.revision + 1 }).where(scope).returning();
      await tx.insert(s.auditLogs).values({ userId, tenantId, resourceId: brandId, action: 'BRAND_PROFILE_UPDATED', correlationId, metadata: { previousRevision: brand.revision, revision: brand.revision + 1 } });
      return updated;
    });
  }
}
