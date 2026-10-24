import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminFinanceRepository, AdminRepository, BillingRepository, LedgerRepository } from '../../packages/db/src/index';
import { AdminService } from '../../packages/core/src/admin';
import { isolatedTestDatabase } from '../helpers/isolated-database';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('operator financial evidence aggregates', () => {
  const database = isolatedTestDatabase(url), repository = new AdminFinanceRepository(database.db);
  const service = new AdminService(new AdminRepository(database.db), true, [], repository);
  const actor = randomUUID(), owner = randomUUID(), tenant = randomUUID(), brand = randomUUID(), workspace = randomUUID(), job = randomUUID(), correlation = randomUUID();
  const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString();
  const input = { from, to, tenantId: tenant, paymentMode: 'LIVE', groupBy: 'BRAND' };
  beforeAll(async () => {
    for (const id of [actor, owner]) await database.client`insert into users(id,email,name,password_hash,email_verified_at) values(${id},${`${id}@example.test`},'Finance fixture','password-sentinel',now())`;
    await database.client`insert into platform_operators(user_id,role) values(${actor},'SUPPORT')`;
    await database.client`insert into organizations(id,name) values(${tenant},'Finance fixture')`;
    await database.client`insert into organization_members(tenant_id,user_id,role) values(${tenant},${owner},'OWNER')`;
    await database.client`insert into workspaces(id,tenant_id,name) values(${workspace},${tenant},'Workspace')`;
    await database.client`insert into brands(id,tenant_id,workspace_id,name) values(${brand},${tenant},${workspace},'Brand')`;
    for (const [id, type] of [[job, 'GENERATE_SCRIPT'], [randomUUID(), 'GENERATE_VIDEO']]) {
      const reservation = randomUUID();
      await database.client`insert into usage_reservations(id,tenant_id,key,unit,amount) values(${reservation},${tenant},${randomUUID()},'AI_CREDITS',1)`;
      await database.client`insert into jobs(id,tenant_id,brand_id,requested_by,type,status,input,input_hash,idempotency_key,reservation_id,provider,model,correlation_id) values(${id!},${tenant},${brand},${owner},${type!},'FAILED','{"secret":"job-input-sentinel"}','hash',${randomUUID()},${reservation},'fixture','model',${correlation})`;
    }
    for (const [call, cost, currency] of [[1, '9007199254740993', 'USD'], [2, null, 'USD'], [3, '0', 'RUB']] as const)
      await database.client`insert into ai_calls(tenant_id,job_id,attempt,call,provider,model,status,provider_cost_microunits,currency,output) values(${tenant},${job},1,${call},'fixture','model','SUCCEEDED',${cost},${currency},'{"secret":"output-sentinel"}')`;
    await database.client`insert into ai_calls(tenant_id,job_id,attempt,call,provider,model,status,provider_cost_microunits,currency,created_at) values(${tenant},${job},1,4,'fixture','model','SUCCEEDED',999,'USD',${to})`;
    const ledger = new LedgerRepository(database.db);
    await ledger.adjust(tenant, 'AI_CREDITS', 100, randomUUID(), correlation);
    const reservation = await ledger.reserve(tenant, 'AI_CREDITS', 10, randomUUID(), correlation);
    await ledger.settle(tenant, reservation.id, 'CAPTURE', correlation, 4);
    const held = await ledger.reserve(tenant, 'AI_CREDITS', 9, randomUUID(), correlation);
    await ledger.settle(tenant, held.id, 'RELEASE', correlation);
    const [plan] = await database.client`update plans set enabled=true where code='START' returning id`;
    const version = randomUUID();
    await database.client`insert into plan_versions(id,plan_id,version,amount_minor,ai_credits,video_seconds) values(${version},${plan!.id},1,199900,10,60)`;
    const billing = new BillingRepository(database.db);
    for (const test of [false, true]) {
      const merchant = { provider: 'yookassa' as const, merchantId: '100500', test };
      const order = await billing.checkout(owner, tenant, version, randomUUID(), { returnUrl: 'https://example.test/return', receipt: { customerEmail: 'fixture@example.test', vatCode: 11, taxSystemCode: 1, mode: 'full_payment', subject: 'service' } }, merchant, correlation);
      const observation = { ...merchant, externalId: randomUUID(), internalId: order.id, amountMinor: 199900, currency: 'RUB' as const, status: 'SUCCEEDED' as const, paid: true };
      await billing.settle(tenant, order.id, observation); await billing.settle(tenant, order.id, observation);
    }
  });
  it('requires operator authority and validates bounded UTC windows', async () => {
    await expect(service.finance(owner, input, correlation)).rejects.toThrow('NOT_AUTHORIZED');
    for (const patch of [{ to: from }, { to: new Date(Date.parse(from) + 94 * 86400000).toISOString() }, { tenantId: 'invalid' }, { groupBy: 'SQL' }, { paymentMode: 'ALL' }]) expect(() => service.finance(actor, { ...input, ...patch }, correlation)).toThrow();
    expect(() => new AdminService(new AdminRepository(database.db), false, [], repository).finance(actor, input, correlation)).toThrow('CONFIGURATION_REQUIRED');
  });
  it('separates test settlements and does not multiply money by AI or ledger rows', async () => {
    const report = await service.finance(actor, input, correlation);
    expect(report.revenue).toEqual([{ currency: 'RUB', amountMinor: '199900', payments: '1' }]);
    expect((await service.finance(actor, { ...input, paymentMode: 'TEST' }, correlation)).revenue).toEqual(report.revenue);
    expect(report.captured).toEqual([{ unit: 'AI_CREDITS', amount: '4' }]);
    expect(report.grossMargin).toBeNull();
  });
  it('preserves integer precision, currencies, unknown costs and the exclusive boundary', async () => {
    const report = await service.finance(actor, input, correlation);
    expect(report.costs).toEqual([{ currency: 'RUB', knownMicrounits: '0', calls: '1', unknownCalls: '0' }, { currency: 'USD', knownMicrounits: '9007199254740993', calls: '2', unknownCalls: '1' }]);
    expect(report.jobsWithoutCostEvidence).toBe('1'); expect(report.videoJobsWithoutCostEvidence).toBe('1');
    expect(report.groups.map(row => row.entityId)).toEqual([brand, brand]);
    expect(JSON.stringify(report)).not.toMatch(/sentinel|password|customerEmail/);
    expect((await service.finance(actor, { ...input, groupBy: 'USER' }, correlation)).groups.every(row => row.entityId === owner)).toBe(true);
    expect((await service.finance(actor, { ...input, groupBy: 'PROVIDER' }, correlation)).groups.every(row => row.entityId === 'fixture')).toBe(true);
  });
  it('filters every data source by tenant and audits reads without contents', async () => {
    const report = await service.finance(actor, { ...input, tenantId: randomUUID() }, correlation);
    expect(report.revenue).toEqual([]); expect(report.costs).toEqual([]); expect(report.groups).toEqual([]); expect(report.captured).toEqual([]); expect(report.jobsWithoutCostEvidence).toBe('0');
    expect((await database.client`select id from audit_logs where action='ADMIN_FINANCE_READ'`).length).toBeGreaterThan(0);
  });
  it('bounds grouping rows without truncating totals', async () => {
    for (let i = 0; i < 52; i++) await database.client`insert into ai_calls(tenant_id,job_id,attempt,call,provider,model,status,provider_cost_microunits,currency) values(${tenant},${job},2,${i+1},${`provider-${i}`},'model','SUCCEEDED',1,'RUB')`;
    const report = await service.finance(actor, { ...input, groupBy: 'PROVIDER' }, correlation);
    expect(report.groups).toHaveLength(50); expect(report.groupsTruncated).toBe(true);
    expect(report.costs.find(row => row.currency === 'RUB')?.knownMicrounits).toBe('52');
  });
  it('immediately denies revoked operators', async () => {
    await database.client`update platform_operators set revoked_at=now() where user_id=${actor}`;
    await expect(service.finance(actor, input, correlation)).rejects.toThrow('NOT_AUTHORIZED');
  });
});
