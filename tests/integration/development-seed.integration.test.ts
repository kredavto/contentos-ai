import { describe, expect, it } from 'vitest';
import { seedDevelopment, demoEmail, demoIds } from '../../packages/db/src/development-seed';
import { BrandRepository, ContentRepository } from '../../packages/db/src/index';
import { hashPassword, verifyPassword } from '../../packages/core/src/password';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('atomic development seed', () => {
  const database = isolatedTestDatabase(url);
  it('rolls back completely on an occupied fixture ID without adopting accounts', async () => {
    const hash = await hashPassword('synthetic-seed-password');
    await database.client`insert into organizations(id,name) values(${demoIds.tenant},'Existing organization')`;
    await expect(seedDevelopment(database.db, hash)).rejects.toThrow();
    expect(await database.client`select id from users where email=${demoEmail}`).toHaveLength(0);
    expect(await database.client`select id from audit_logs where action='DEVELOPMENT_SEED_V1'`).toHaveLength(0);
    await database.client`delete from organizations where id=${demoIds.tenant}`;
  });
  it('serializes repeated runs and produces readable fixture content with no queued side effects', async () => {
    const hash = await hashPassword('synthetic-seed-password');
    const results = await Promise.all([seedDevelopment(database.db, hash), seedDevelopment(database.db, hash)]);
    expect(results.filter(result => result.created)).toHaveLength(1);
    const brain = await new BrandRepository(database.db).getBrandBrain(demoIds.user, demoIds.tenant, demoIds.brand);
    expect(brain.brand.onboardingCompletedAt).not.toBeNull(); expect(brain.data.products).toHaveLength(1);
    const content = await new ContentRepository(database.db).overview(demoIds.user, demoIds.tenant, demoIds.brand);
    expect(content.strategies[0]?.content.plan).toHaveLength(30); expect(content.ideas).toHaveLength(3); expect(content.scripts).toHaveLength(1); expect(content.scripts[0]?.approvedVersion).toBeNull();
    const [ledger] = await database.client`select sum(available_delta)::int as available,sum(reserved_delta)::int as reserved from usage_ledger where tenant_id=${demoIds.tenant}`;
    expect(ledger).toEqual({ available: 99, reserved: 0 });
    for (const table of ['outbox', 'publishing_jobs', 'email_outbox', 'social_connections']) expect(await database.client`select * from ${database.client(table)}`).toHaveLength(0);
  });
  it('preserves edited data, disabled account and password on rerun without additional credit grants', async () => {
    await database.client`update users set disabled_at=now() where id=${demoIds.user}`;
    await database.client`update brands set name='Edited brand' where id=${demoIds.brand}`;
    const changedHash = await hashPassword('different-seed-password');
    expect((await seedDevelopment(database.db, changedHash)).created).toBe(false);
    const [user] = await database.client`select password_hash,disabled_at from users where id=${demoIds.user}`;
    expect(await verifyPassword('synthetic-seed-password', user!.password_hash)).toBe(true); expect(user!.disabled_at).not.toBeNull();
    expect((await database.client`select name from brands where id=${demoIds.brand}`)[0]?.name).toBe('Edited brand');
    expect(await database.client`select id from usage_ledger where tenant_id=${demoIds.tenant}`).toHaveLength(3);
  });
});
