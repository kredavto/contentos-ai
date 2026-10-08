import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createDatabase, EmailRepository, AuthRepository, BrandRepository } from '../../packages/db/src/index';
import { CredentialVault } from '../../packages/core/src/credential-vault';
import { EmailProcessor } from '../../packages/core/src/email';
import { AuthService } from '../../packages/core/src/auth';
import { BrandService } from '../../packages/core/src/brands';
import { hashToken } from '../../packages/core/src/password';
import { emptyOnboarding, type EmailProvider, type OperationContext } from '../../packages/types/src/index';
const url = process.env.TEST_DATABASE_URL;
const suite = describe.skipIf(!url);
suite('persisted identity, isolation and onboarding', () => {
  if (url && !new URL(url).pathname.endsWith('_test')) throw new Error('Integration tests require a database ending in _test');
  const database = createDatabase(url ?? 'postgresql://localhost/unused_test');
  const emails: Array<{ recipient: string; text: string }> = [];
  const emailProvider: EmailProvider = { async send(input, context: OperationContext) { emails.push(input); return { provider: 'test', externalId: randomUUID(), internalId: context.internalId, metadata: {} }; } };
  const authRepository = new AuthRepository(database.db);
  const vault=new CredentialVault(JSON.stringify({test:Buffer.alloc(32,9).toString('base64')}),'test');
  const auth = new AuthService(authRepository, vault, 'http://localhost:3000', 'Test');
  const mailProcessor=new EmailProcessor(new EmailRepository(database.db),emailProvider,vault);
  async function deliver(userId:string){const pending=await database.client`select id from email_outbox where user_id=${userId} and status='PENDING'`;for(const row of pending)await mailProcessor.runOnce(row.id as string);}
  const brands = new BrandService(new BrandRepository(database.db));
  const run = randomUUID();
  const email = `owner-${run}@example.test`;
  const otherEmail = `other-${run}@example.test`;
  const correlationId = randomUUID();
  let userId = ''; let otherUserId = ''; let tenantId = ''; let otherTenantId = ''; let brandId = ''; let token = '';
  function lastToken(recipient: string) {
    const message = emails.filter(item => item.recipient === recipient).at(-1);
    const match = message?.text.match(/token=([a-zA-Z0-9_-]+)/);
    if (!match?.[1]) throw new Error('Expected token email');
    return match[1];
  }
  beforeAll(async () => {
    await auth.register({ email, name: 'Demo owner', password: 'correct-test-password' }, run, correlationId);
    await auth.register({ email: otherEmail, name: 'Demo outsider', password: 'correct-test-password' }, run, correlationId);
    userId = (await authRepository.findUser(email))!.id;
    otherUserId = (await authRepository.findUser(otherEmail))!.id;
    await deliver(userId);await deliver(otherUserId);
  });
  afterAll(async () => {
    if (tenantId) await database.client`delete from organizations where id = ${tenantId}`;
    if (otherTenantId) await database.client`delete from organizations where id = ${otherTenantId}`;
    if (userId) await database.client`delete from users where id = ${userId}`;
    if (otherUserId) await database.client`delete from users where id = ${otherUserId}`;
    await database.close();
  });
  it('hashes verification tokens and consumes them only once under concurrent delivery', async () => {
    const verification = lastToken(email);
    const stored = await database.client`select token_hash from auth_tokens where user_id = ${userId}`;
    expect(stored[0]?.token_hash).toBe(hashToken(verification));
    const results = await Promise.allSettled([auth.verify({ token: verification }, run, correlationId), auth.verify({ token: verification }, run, correlationId)]);
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    expect((await authRepository.findUser(email))?.emailVerifiedAt).not.toBeNull();
  });
  it('creates hashed revocable sessions and rejects wrong credentials', async () => {
    await expect(auth.login({ email, password: 'incorrect' }, run, correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    token = (await auth.login({ email, password: 'correct-test-password' }, run, correlationId)).token;
    expect((await auth.session(token))?.userId).toBe(userId);
    const rows = await database.client`select token_hash from sessions where user_id = ${userId}`;
    expect(rows[0]?.token_hash).toBe(hashToken(token));
  });
  it('isolates tenants at both service and foreign-key levels', async () => {
    tenantId = (await brands.createOrganization(userId, { name: 'Test organization A' }, correlationId)).id;
    otherTenantId = (await brands.createOrganization(otherUserId, { name: 'Test organization B' }, correlationId)).id;
    await expect(database.client`update organization_members set role = 'SUPERADMIN' where tenant_id = ${tenantId} and user_id = ${userId}`).rejects.toThrow();
    const own = await brands.overview(userId, tenantId);
    const other = await brands.overview(otherUserId, otherTenantId);
    expect(await brands.listOrganizations(userId)).toHaveLength(1);
    await expect(brands.overview(userId, otherTenantId)).rejects.toThrow('NOT_FOUND');
    await expect(brands.createBrand(userId, tenantId, { name: 'Cross tenant', workspaceId: other.workspaces[0]!.id }, correlationId)).rejects.toThrow('NOT_FOUND');
    await expect(database.client`insert into brands (tenant_id, workspace_id, name) values (${tenantId}, ${other.workspaces[0]!.id}, 'Forbidden')`).rejects.toThrow();
    brandId = (await brands.createBrand(userId, tenantId, { name: 'Test brand', workspaceId: own.workspaces[0]!.id }, correlationId)).id;
    await expect(brands.getBrandBrain(otherUserId, otherTenantId, brandId)).rejects.toThrow('NOT_FOUND');
  });
  it('saves and resumes normalized onboarding, detects stale revisions and enforces member roles', async () => {
    const data = { ...emptyOnboarding('Test brand'), niche: 'Education', geography: 'Online', products: [{ name: 'Course', description: 'Engineering' }], audience: [{ name: 'Builders', description: 'Learn engineering' }], pains: [{ name: 'Time', description: 'Need concise lessons' }], usp: 'Practical examples', voice: 'Clear and friendly', goals: ['Awareness'], platforms: ['YOUTUBE'] as const, ctas: [{ name: 'Learn more', description: 'Visit our website' }] };
    await brands.saveOnboarding(userId, tenantId, brandId, { data, step: 6, revision: 0, complete: false }, correlationId);
    const saved = await brands.getBrandBrain(userId, tenantId, brandId);
    expect(saved.brand.onboardingStep).toBe(6);
    expect(saved.data.products[0]?.name).toBe('Course');
    const products = await database.client`select name from products where tenant_id = ${tenantId} and brand_id = ${brandId}`;
    expect(products[0]?.name).toBe('Course');
    await expect(brands.saveOnboarding(userId, tenantId, brandId, { data, step: 7, revision: 0, complete: false }, correlationId)).rejects.toThrow('CONFLICT');
    await database.client`insert into organization_members (tenant_id, user_id, role) values (${tenantId}, ${otherUserId}, 'VIEWER')`;
    await expect(brands.saveOnboarding(otherUserId, tenantId, brandId, { data, step: 14, revision: 1, complete: true }, correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    await brands.saveOnboarding(userId, tenantId, brandId, { data, step: 14, revision: 1, complete: true }, correlationId);
    expect((await brands.getBrandBrain(userId, tenantId, brandId)).brand.onboardingCompletedAt).not.toBeNull();
    await expect(brands.saveOnboarding(userId, tenantId, brandId, { data, step: 14, revision: 2, complete: true }, correlationId)).rejects.toThrow('CONFLICT');
  });
  it('password reset revokes all sessions and prevents reuse or stale login issuance', async () => {
    const oldHash = (await authRepository.findUser(email))!.passwordHash;
    await auth.requestToken({ email }, 'RESET_PASSWORD', run, correlationId);await deliver(userId);
    const resetToken = lastToken(email);
    await auth.reset({ token: resetToken, password: 'replacement-test-password' }, run, correlationId);
    expect(await auth.session(token)).toBeUndefined();
    expect(await authRepository.createSession(userId, oldHash, 'stale-token-hash', new Date(Date.now() + 10000), correlationId)).toBe(false);
    await expect(auth.reset({ token: resetToken, password: 'another-test-password' }, run, correlationId)).rejects.toThrow('INVALID_INPUT');
    await expect(auth.login({ email, password: 'correct-test-password' }, run, correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    const fresh = await auth.login({ email, password: 'replacement-test-password' }, run, correlationId);
    await auth.logout(fresh.token, correlationId);
    expect(await auth.session(fresh.token)).toBeUndefined();
  });
  it('atomically enforces shared rate limits and writes safe audit events', async () => {
    const key = `test-${randomUUID()}`;
    const allowed = await Promise.all(Array.from({ length: 12 }, () => authRepository.rateLimit(key, 3, 60)));
    expect(allowed.filter(Boolean)).toHaveLength(3);
    const logs = await database.client`select action, metadata from audit_logs where correlation_id = ${correlationId}`;
    expect(logs.map(row => row.action)).toContain('BRAND_BRAIN_CREATED');
    expect(JSON.stringify(logs)).not.toContain('password');
    expect(JSON.stringify(logs)).not.toContain(token);
    await database.client`delete from rate_limits where key = ${key}`;
  });
});
