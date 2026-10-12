import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminRepository, BrandRepository, JobRepository, LedgerRepository } from '../../packages/db/src/index';
import { AdminService } from '../../packages/core/src/admin';
import { BrandService } from '../../packages/core/src/brands';
import { adminCategories, emptyOnboarding, generationOptionsSchema } from '../../packages/types/src/index';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('platform operator permissions, projections and support actions', () => {
  const database = isolatedTestDatabase(url);
  const repository = new AdminRepository(database.db), service = new AdminService(repository, true, [{ name: 'AI', provider: 'disabled', model: null, status: 'DISABLED' }]);
  const operator = randomUUID(), target = randomUUID(), unverified = randomUUID(), correlation = randomUUID();
  let tenant = '', cliUrl = '';
  async function provision(mode: 'grant' | 'revoke', userId = operator) {
    return promisify(execFile)(process.execPath, [fileURLToPath(import.meta.resolve('tsx/cli')), 'packages/db/src/operator-cli.ts', '--mode', mode, '--userId', userId, '--role', 'SUPPORT', '--ticket', 'TEST-ADMIN'], { env: { ...process.env, DATABASE_URL: cliUrl } });
  }
  beforeAll(async () => {
    const isolated = new URL(url!); isolated.pathname = `/${(await database.client`select current_database() as name`)[0]!.name as string}`; cliUrl = isolated.href;
    for (const id of [operator, target, unverified]) await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Operator fixture','password-hash-sentinel',${id === unverified ? null : new Date().toISOString()})`;
    const brands = new BrandService(new BrandRepository(database.db));
    tenant = (await brands.createOrganization(target, { name: 'Tenant owner is not platform admin' }, correlation)).id;
    const workspace = (await brands.overview(target, tenant)).workspaces[0]!;
    const brand = await brands.createBrand(target, tenant, { name: 'Admin test brand', workspaceId: workspace.id }, correlation);
    const brain = { ...emptyOnboarding('Admin test brand'), niche: 'Test', geography: 'Online', usp: 'Evidence', voice: 'Clear', products: [{ name: 'Product', description: '' }], audience: [{ name: 'Audience', description: '' }], pains: [{ name: 'Pain', description: '' }], goals: ['Trust'], platforms: ['TELEGRAM'], ctas: [{ name: 'Read', description: '' }] };
    await brands.saveOnboarding(target, tenant, brand.id, { data: brain, revision: 0, step: 14, complete: true }, correlation);
    await new LedgerRepository(database.db).grantTrial(target, tenant, correlation);
    const saved = await brands.getBrandBrain(target, tenant, brand.id);
    const job = await new JobRepository(database.db).enqueue(target, tenant, brand.id, 'GENERATE_SCRIPT', { brain: saved.data, brandRevision: saved.brand.revision, options: generationOptionsSchema.parse({}) }, randomUUID(), 'test', 'fixture-model', correlation);
    await database.client`insert into ai_calls(tenant_id,job_id,attempt,call,provider,model,status,input_units,output_units,output) values(${tenant},${job.id},1,1,'test','fixture-model','SUCCEEDED',10,20,'{"secret":"ai-output-sentinel"}'::jsonb)`;
  });
  it('does not inherit operator access from tenant ownership or a deployment flag', async () => {
    await expect(service.overview(target, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await expect(service.list(target, { category: 'users' }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    expect(await service.canAccess(target)).toBe(false);
    expect(await new AdminService(repository, false, []).canAccess(operator)).toBe(false);
    expect(() => new AdminService(repository, false, []).list(operator, { category: 'users' }, correlation)).toThrow('CONFIGURATION_REQUIRED');
  });
  it('provisions only verified accounts through the explicit host command and audits it', async () => {
    await expect(provision('grant', unverified)).rejects.toThrow();
    const result = await provision('grant'); expect(JSON.parse(result.stdout).userId).toBe(operator);
    expect(await service.canAccess(operator)).toBe(true);
    expect((await service.overview(operator, correlation)).configuration[0]?.status).toBe('DISABLED');
    expect((await database.client`select id from audit_logs where action='PLATFORM_OPERATOR_GRANTED' and resource_id=${operator}`)).toHaveLength(1);
  });
  it('bounds and paginates allowlisted user fields without password or session material', async () => {
    const first = await service.list(operator, { category: 'users', limit: 1 }, correlation);
    expect(first.rows).toHaveLength(1); expect(first.next).not.toBeNull();
    expect(Object.keys(first.rows[0]!)).toEqual(['id', 'email', 'name', 'verifiedAt', 'disabledAt', 'createdAt']);
    expect(JSON.stringify(first)).not.toContain('password-hash-sentinel');
    const second = await service.list(operator, { category: 'users', limit: 1, ...first.next }, correlation);
    expect(second.rows[0]?.id).not.toBe(first.rows[0]?.id);
    expect((await service.list(operator, { category: 'users', userId: target }, correlation)).rows.map(row => row.id)).toEqual([target]);
    expect(() => service.list(operator, { category: 'users', limit: 1000 }, correlation)).toThrow();
    expect(() => service.list(operator, { category: 'users', beforeId: target }, correlation)).toThrow();
    expect(() => service.list(operator, { category: 'plans', tenantId: tenant }, correlation)).toThrow();
  });
  it('covers every operational projection while preserving unknown cost and omitting content', async () => {
    for (const category of adminCategories) {
      const result = await service.list(operator, { category }, correlation);
      expect(result.rows.length).toBeLessThanOrEqual(25);
      expect(JSON.stringify(result)).not.toContain('ai-output-sentinel');
      for (const row of result.rows) for (const key of ['passwordHash', 'tokenHash', 'credential', 'payload', 'input', 'output', 'errorMessage', 'leaseToken']) expect(row).not.toHaveProperty(key);
    }
    const costs = await service.list(operator, { category: 'costs', tenantId: tenant }, correlation);
    expect(costs.rows[0]?.costMicrounits).toBeNull(); expect(costs.rows[0]?.inputUnits).toBe(10);
    expect((await service.list(operator, { category: 'jobs', tenantId: randomUUID() }, correlation)).rows).toEqual([]);
    expect((await service.list(operator, { category: 'failed_jobs', tenantId: tenant }, correlation)).rows).toEqual([]);
  });
  it('revokes sessions atomically and never replays against later logins', async () => {
    for (let i = 0; i < 3; i++) await database.client`insert into sessions(user_id,token_hash,expires_at) values(${target},${randomUUID()},now()+interval '1 hour')`;
    const input = { userId: target, reason: 'SECURITY_INCIDENT', ticket: 'INCIDENT-42', idempotencyKey: randomUUID() };
    const results = await Promise.all([service.revokeSessions(operator, input, correlation), service.revokeSessions(operator, input, correlation)]);
    expect(results[0]).toEqual(results[1]); expect(results[0]?.revokedSessions).toBe(3);
    await database.client`insert into sessions(user_id,token_hash,expires_at) values(${target},'new-login-sentinel',now()+interval '1 hour')`;
    expect(await service.revokeSessions(operator, input, correlation)).toEqual(results[0]);
    expect((await database.client`select id from sessions where user_id=${target}`)).toHaveLength(1);
    await expect(service.revokeSessions(operator, { ...input, ticket: 'DIFFERENT-42' }, correlation)).rejects.toThrow('CONFLICT');
    await expect(database.client`update platform_actions set revoked_sessions=999 where id=${results[0]!.id}`).rejects.toThrow();
    const audits = await database.client`select metadata from audit_logs where action='ADMIN_SESSIONS_REVOKED' and resource_id=${target}`;
    expect(audits).toHaveLength(1); expect(audits[0]?.metadata.revokedSessions).toBe(3); expect(audits[0]?.metadata.actionId).toBe(results[0]!.id);
  });
  it('rejects self/operator targets and immediately rechecks revoked or disabled operators', async () => {
    const input = { userId: operator, reason: 'USER_REQUEST', ticket: 'TEST-42', idempotencyKey: randomUUID() };
    await expect(service.revokeSessions(operator, input, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set disabled_at=now() where id=${operator}`;
    await expect(service.list(operator, { category: 'users' }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    await database.client`update users set disabled_at=null where id=${operator}`;
    await provision('revoke');
    expect(await service.canAccess(operator)).toBe(false);
    await expect(service.revokeSessions(operator, { ...input, userId: target }, correlation)).rejects.toThrow('NOT_AUTHORIZED');
  });
});
