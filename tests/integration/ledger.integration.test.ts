import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, LedgerRepository } from '../../packages/db/src/index';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('immutable usage ledger', () => {
  if (url && !new URL(url).pathname.endsWith('_test')) throw new Error('Dedicated test database required');
  const database = createDatabase(url ?? 'postgresql://localhost/unused_test');
  const ledger = new LedgerRepository(database.db);
  const tenantId = randomUUID(); const otherTenantId = randomUUID(); const userId = randomUUID(); const correlationId = randomUUID();
  beforeAll(async () => {
    await database.client`insert into users (id,email,password_hash,name,email_verified_at) values (${userId},${`ledger-${userId}@example.test`},'unusable-test-hash','Fictional ledger owner',now())`;
    await database.client`insert into organizations (id,name) values (${tenantId},'Ledger test'),(${otherTenantId},'Other ledger test')`;
    await database.client`insert into organization_members (tenant_id,user_id,role) values (${tenantId},${userId},'OWNER'),(${otherTenantId},${userId},'OWNER')`;
  });
  // Financial history intentionally remains append-only, even in the dedicated
  // disposable CI database. Tests use fresh UUIDs and never disable triggers.
  afterAll(() => database.close());
  it('grants a trial only once per user across concurrent organizations', async () => {
    const grants = await Promise.all([ledger.grantTrial(userId,tenantId,correlationId), ledger.grantTrial(userId,otherTenantId,correlationId)]);
    expect(grants.filter(grant => grant.granted)).toHaveLength(1);
    const totals = await database.client`select sum(available_delta)::int as total from usage_ledger where tenant_id in (${tenantId},${otherTenantId}) and unit='AI_CREDITS'`;
    expect(totals[0]?.total).toBe(100);
    const videoTotals=await database.client`select sum(available_delta)::int as total from usage_ledger where tenant_id in (${tenantId},${otherTenantId}) and unit='VIDEO_SECONDS'`;
    expect(videoTotals[0]?.total).toBe(180);
  });
  it('serializes competing reservations and prevents overdrafts', async () => {
    const current = (await ledger.overview(userId,tenantId)).balances.AI_CREDITS.available;
    if (current) await ledger.adjust(tenantId,'AI_CREDITS',-current,'normalize-test',correlationId);
    await ledger.adjust(tenantId,'AI_CREDITS',10,'fund-test',correlationId);
    const attempts = await Promise.allSettled(Array.from({length: 8}, (_,i) => ledger.reserve(tenantId,'AI_CREDITS',3,`concurrent-${i}`,correlationId)));
    expect(attempts.filter(attempt => attempt.status === 'fulfilled')).toHaveLength(3);
    expect((await ledger.overview(userId,tenantId)).balances.AI_CREDITS).toEqual({ available: 1, reserved: 9 });
    for (const attempt of attempts) if (attempt.status === 'fulfilled') await ledger.settle(tenantId,attempt.value.id,'RELEASE',correlationId);
  });
  it('deduplicates reservation and settlement without changing balances twice', async () => {
    const reservations = await Promise.all(Array.from({length: 4}, () => ledger.reserve(tenantId,'AI_CREDITS',4,'same-request',correlationId)));
    expect(new Set(reservations.map(item => item.id)).size).toBe(1);
    await expect(ledger.reserve(tenantId,'AI_CREDITS',5,'same-request',correlationId)).rejects.toThrow('CONFLICT');
    const reservation = reservations[0]!;
    await expect(ledger.settle(otherTenantId,reservation.id,'CAPTURE',correlationId)).rejects.toThrow('NOT_FOUND');
    await Promise.all(Array.from({length: 4}, () => ledger.settle(tenantId,reservation.id,'CAPTURE',correlationId)));
    await expect(ledger.settle(tenantId,reservation.id,'RELEASE',correlationId)).rejects.toThrow('CONFLICT');
    expect((await ledger.overview(userId,tenantId)).balances.AI_CREDITS).toEqual({ available: 6, reserved: 0 });
  });
  it('enforces immutable history and reservation consistency in PostgreSQL', async () => {
    await expect(database.client`update usage_ledger set amount = 999 where tenant_id = ${tenantId}`).rejects.toThrow('Append-only');
    await expect(database.client`delete from usage_ledger where tenant_id = ${tenantId}`).rejects.toThrow('Append-only');
    const reservation = await ledger.reserve(tenantId,'AI_CREDITS',2,'consistency',correlationId);
    await expect(database.client`insert into usage_ledger (tenant_id,reservation_id,unit,type,amount,available_delta,reserved_delta,idempotency_key,correlation_id) values (${tenantId},${reservation.id},'AI_CREDITS','RELEASE',1,1,-1,'forged',${correlationId})`).rejects.toThrow('does not match');
    await ledger.settle(tenantId,reservation.id,'RELEASE',correlationId);
  });
  it('captures actual video seconds, releases the remainder once and rejects changed settlement',async()=>{
    const videoBalance=(await ledger.overview(userId,otherTenantId)).balances.VIDEO_SECONDS.available;
    if(videoBalance)await ledger.adjust(otherTenantId,'VIDEO_SECONDS',-videoBalance,'normalize-video',correlationId);
    await ledger.adjust(otherTenantId,'VIDEO_SECONDS',180,'video-fixture',correlationId);
    const reservation=await ledger.reserve(otherTenantId,'VIDEO_SECONDS',180,'video-budget',correlationId);
    await expect(ledger.settle(otherTenantId,reservation.id,'CAPTURE',correlationId,181)).rejects.toThrow('INVALID_INPUT');
    await Promise.all(Array.from({length:4},()=>ledger.settle(otherTenantId,reservation.id,'CAPTURE',correlationId,12)));
    expect((await ledger.overview(userId,otherTenantId)).balances.VIDEO_SECONDS).toEqual({available:168,reserved:0});
    await expect(ledger.settle(otherTenantId,reservation.id,'CAPTURE',correlationId,13)).rejects.toThrow('CONFLICT');
    await expect(database.client`update usage_reservations set status='HELD' where id=${reservation.id}`).rejects.toThrow('must match');
    const rows=await database.client`select type,amount from usage_ledger where reservation_id=${reservation.id} order by type`;
    expect(rows.map(row=>[row.type,row.amount])).toEqual([['CAPTURE',12],['RELEASE',168],['RESERVE',180]]);
  });
  it('isolates units and rejects unauthorized reads or grants', async () => {
    const videoBalance=(await ledger.overview(userId,tenantId)).balances.VIDEO_SECONDS.available;
    if(videoBalance)await ledger.adjust(tenantId,'VIDEO_SECONDS',-videoBalance,'normalize-video',correlationId);
    await expect(ledger.reserve(tenantId,'VIDEO_SECONDS',1,'video',correlationId)).rejects.toThrow('INSUFFICIENT_VIDEO_SECONDS');
    await expect(ledger.overview(randomUUID(),tenantId)).rejects.toThrow('NOT_FOUND');
    await database.client`update organization_members set role = 'VIEWER' where user_id = ${userId} and tenant_id = ${tenantId}`;
    await expect(ledger.grantTrial(userId,tenantId,correlationId)).rejects.toThrow('NOT_AUTHORIZED');
    expect((await ledger.overview(userId,tenantId)).balances.VIDEO_SECONDS).toEqual({ available: 0, reserved: 0 });
  });
});
