import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, BrandRepository } from '../../packages/db/src/index';
import { BrandService } from '../../packages/core/src/brands';
import { emptyOnboarding, brandProfileSchema } from '../../packages/types/src/index';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('completed Brand Brain profile', () => {
  if (url && !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const database = createDatabase(url ?? 'postgresql://localhost/unused_test');
  const service = new BrandService(new BrandRepository(database.db));
  const user = randomUUID(), viewer = randomUUID(), tenant = randomUUID(), workspace = randomUUID(), correlation = randomUUID();
  let brand = '';
  const data = { ...emptyOnboarding('Brand'), niche: 'Education', geography: 'Online', usp: 'Examples', voice: 'Calm', products: [{ name: 'Course', description: '' }], audience: [{ name: 'Students', description: '' }], pains: [{ name: 'Time', description: '' }], goals: ['Trust'], platforms: ['TELEGRAM'], ctas: [{ name: 'Visit', description: '' }] };
  const profile = () => brandProfileSchema.parse({ company: 'Updated brand', website: '', niche: 'Engineering', geography: 'Worldwide', usp: 'Practice', voice: 'Precise', goals: ['Learning'], platforms: ['YOUTUBE'] });
  beforeAll(async () => {
    for (const id of [user, viewer]) await database.client`insert into users(id,email,password_hash,name,email_verified_at) values(${id},${`${id}@example.test`},'unusable','Test',now())`;
    await database.client`insert into organizations(id,name) values(${tenant},'Profile test')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${user},'OWNER'),(${tenant},${viewer},'VIEWER')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenant},'Test')`;
    brand = (await service.createBrand(user, tenant, { name: 'Brand', workspaceId: workspace }, correlation)).id;
  });
  afterAll(async () => {
    await database.client`delete from organizations where id=${tenant}`;
    await database.client`delete from users where id in (${user},${viewer})`;
    await database.close();
  });
  it('requires completed onboarding, valid fields and current membership', async () => {
    await expect(service.saveProfile(user, tenant, brand, { revision: 0, data: profile() }, correlation)).rejects.toThrow('CONFLICT');
    await service.saveOnboarding(user, tenant, brand, { revision: 0, step: 14, complete: true, data }, correlation);
    await expect(service.saveProfile(viewer, tenant, brand, { revision: 1, data: profile() }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.saveProfile(user, tenant, randomUUID(), { revision: 1, data: profile() }, correlation)).rejects.toThrow('NOT_FOUND');
    await expect(service.saveProfile(user, randomUUID(), brand, { revision: 1, data: profile() }, correlation)).rejects.toThrow('NOT_FOUND');
    expect(() => service.saveProfile(user, tenant, brand, { revision: 1, data: { ...profile(), niche: '' } }, correlation)).toThrow();
    expect(() => service.saveProfile(user, tenant, brand, { revision: 1, data: { ...profile(), products: [] } }, correlation)).toThrow();
  });
  it('serializes concurrent changes, preserves entity IDs and logs revision without content', async () => {
    const audienceBefore = await database.client`select * from audience_segments where brand_id=${brand}`;
    const voiceBefore = await database.client`select id from brand_voice where brand_id=${brand}`;
    const outcomes = await Promise.allSettled([1, 2].map(() => service.saveProfile(user, tenant, brand, { revision: 1, data: profile() }, correlation)));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(outcome => outcome.status === 'rejected')).toHaveLength(1);
    const saved = await service.getBrandBrain(user, tenant, brand);
    expect(saved.brand.revision).toBe(2); expect(saved.data.company).toBe('Updated brand'); expect(saved.data.voice).toBe('Precise'); expect(saved.data.products).toEqual(data.products);
    expect(await database.client`select * from audience_segments where brand_id=${brand}`).toEqual(audienceBefore);
    expect(await database.client`select id from brand_voice where brand_id=${brand}`).toEqual(voiceBefore);
    const audit = await database.client`select metadata from audit_logs where resource_id=${brand} and action='BRAND_PROFILE_UPDATED'`;
    expect(audit).toHaveLength(1); expect(audit[0]?.metadata).toEqual({ previousRevision: 1, revision: 2 });
  });
  it('rechecks verification and disabled status inside the write transaction', async () => {
    await database.client`update users set email_verified_at=null where id=${user}`;
    await expect(service.saveProfile(user, tenant, brand, { revision: 2, data: profile() }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set email_verified_at=now(),disabled_at=now() where id=${user}`;
    await expect(service.saveProfile(user, tenant, brand, { revision: 2, data: profile() }, correlation)).rejects.toThrow('NOT_FOUND');
    await database.client`update users set disabled_at=null where id=${user}`;
  });
  it('edits all structured collections and excludes archived context without deleting identity', async () => {
    const audience = await service.collection(user, tenant, brand, 'audience');
    const oldId = audience.entries[0]!.id;
    await service.saveCollection(user, tenant, brand, 'audience', { revision: audience.revision, entries: [{ name: 'Experts', description: 'Experienced builders' }] }, correlation);
    const archived = await database.client`select archived_at from audience_segments where id=${oldId}`;
    expect(archived).toHaveLength(1); expect(archived[0]?.archived_at).not.toBeNull();
    expect((await service.getBrandBrain(user, tenant, brand)).data.audience.map(row => row.name)).toEqual(['Experts']);
    for (const collection of ['desires', 'objections', 'positioning', 'pillars', 'offers', 'rules']) {
      const before = await service.collection(user, tenant, brand, collection);
      await service.saveCollection(user, tenant, brand, collection, { revision: before.revision, entries: [{ name: collection, description: 'Structured context' }] }, correlation);
      const saved = await service.collection(user, tenant, brand, collection);
      const id = saved.entries[0]!.id;
      await service.saveCollection(user, tenant, brand, collection, { revision: saved.revision, entries: [{ id, name: collection, description: 'Updated context' }] }, correlation);
      expect((await service.collection(user, tenant, brand, collection)).entries[0]?.id).toBe(id);
    }
    const brain = await service.getBrandBrain(user, tenant, brand);
    expect(brain.data.rules?.[0]?.description).toBe('Updated context');
    expect(brain.data.desires?.[0]?.name).toBe('desires');
    await expect(service.saveCollection(user, tenant, brand, 'audience', { revision: brain.brand.revision, entries: [{ id: oldId, name: 'Revived', description: '' }] }, correlation)).rejects.toThrow('NOT_FOUND');
  });
  it('guards collection permissions, duplicate IDs, required lists and stale revisions', async () => {
    const current = await service.collection(user, tenant, brand, 'products');
    const input = { revision: current.revision, entries: current.entries };
    await expect(service.saveCollection(viewer, tenant, brand, 'products', input, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.saveCollection(user, tenant, brand, 'products', { ...input, entries: [] }, correlation)).rejects.toThrow('INVALID_INPUT');
    expect(() => service.saveCollection(user, tenant, brand, 'products', { ...input, entries: [...current.entries, ...current.entries] }, correlation)).toThrow();
    await expect(service.saveCollection(user, tenant, brand, 'products', { ...input, entries: [{ id: randomUUID(), name: 'Foreign', description: '' }] }, correlation)).rejects.toThrow('NOT_FOUND');
    const outcomes = await Promise.allSettled([1, 2].map(() => service.saveCollection(user, tenant, brand, 'products', input, correlation)));
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
  });

});
