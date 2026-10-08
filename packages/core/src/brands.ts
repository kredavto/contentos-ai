import { z } from 'zod';
import { BrandRepository } from '@contentos/db';
import { onboardingSaveSchema, brandProfileSaveSchema, brainCollectionSchema, brainCollectionSaveSchema } from '@contentos/types';
const id = z.uuid();
const writers = ['OWNER', 'ADMIN', 'MANAGER'] as const;
export class BrandService {
  constructor(private readonly repository: BrandRepository) {}
  listOrganizations(userId: string) { return this.repository.listOrganizations(userId); }
  createOrganization(userId: string, raw: unknown, correlationId: string) {
    const input = z.object({ name: z.string().trim().min(1).max(120), timezone: z.string().max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }).default('Europe/Moscow') }).strict().parse(raw);
    return this.repository.createOrganization(userId, input.name, input.timezone, correlationId);
  }
  overview(userId: string, tenantId: string) { return this.repository.overview(userId, id.parse(tenantId)); }
  createBrand(userId: string, tenantId: string, raw: unknown, correlationId: string) {
    const input = z.object({ name: z.string().trim().min(1).max(120), workspaceId: id }).strict().parse(raw);
    return this.repository.createBrand(userId, id.parse(tenantId), input.workspaceId, input.name, writers, correlationId);
  }
  getBrandBrain(userId: string, tenantId: string, brandId: string) { return this.repository.getBrandBrain(userId, id.parse(tenantId), id.parse(brandId)); }
  collection(userId: string, tenantId: string, brandId: string, collection: string) {
    return this.repository.collection(userId, id.parse(tenantId), id.parse(brandId), brainCollectionSchema.parse(collection));
  }
  saveCollection(userId: string, tenantId: string, brandId: string, collection: string, raw: unknown, correlationId: string) {
    return this.repository.saveCollection(userId, id.parse(tenantId), id.parse(brandId), brainCollectionSchema.parse(collection), brainCollectionSaveSchema.parse(raw), correlationId);
  }
  saveProfile(userId: string, tenantId: string, brandId: string, raw: unknown, correlationId: string) {
    return this.repository.saveProfile(userId, id.parse(tenantId), id.parse(brandId), brandProfileSaveSchema.parse(raw), correlationId);
  }
  saveOnboarding(userId: string, tenantId: string, brandId: string, raw: unknown, correlationId: string) {
    return this.repository.saveOnboarding(userId, id.parse(tenantId), id.parse(brandId), onboardingSaveSchema.parse(raw), writers, correlationId);
  }
}
