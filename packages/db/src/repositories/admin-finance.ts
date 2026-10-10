import { sql } from 'drizzle-orm';
import type { AdminFinanceInput, AdminFinanceReport } from '@contentos/types';
import type { Database } from '../index';
import { auditLogs } from '../schema';
import { assertPlatformOperator } from './admin';
/** Monetary aggregates stay decimal strings: SQL sums can exceed JS safe integers. */
export class AdminFinanceRepository {
  constructor(private readonly db: Database) {}
  report(userId: string, input: AdminFinanceInput, correlationId: string): Promise<AdminFinanceReport> {
    return this.db.transaction(async tx => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      await assertPlatformOperator(tx, userId);
      const from = input.from, to = input.to;
      const callScope = sql`a.created_at >= ${from}::timestamptz and a.created_at < ${to}::timestamptz ${input.tenantId ? sql`and a.tenant_id = ${input.tenantId}::uuid` : sql``}`;
      const group = input.groupBy === 'USER' ? sql`j.requested_by::text` : input.groupBy === 'BRAND' ? sql`j.brand_id::text` : sql`a.provider`;
      const revenue = await tx.execute<AdminFinanceReport['revenue'][number]>(sql`
        select o.currency, sum(o.amount_minor)::text as "amountMinor", count(*)::text as payments
        from payment_settlements p join billing_orders o on o.tenant_id=p.tenant_id and o.id=p.order_id
        where p.created_at >= ${from}::timestamptz and p.created_at < ${to}::timestamptz and o.test=${input.paymentMode === 'TEST'}
          ${input.tenantId ? sql`and p.tenant_id=${input.tenantId}::uuid` : sql``}
        group by o.currency order by o.currency`);
      const costs = await tx.execute<AdminFinanceReport['costs'][number]>(sql`
        select a.currency, coalesce(sum(a.provider_cost_microunits) filter(where a.provider_cost_microunits >= 0),0)::text as "knownMicrounits",
          count(*)::text as calls, count(*) filter(where a.provider_cost_microunits is null or a.provider_cost_microunits < 0)::text as "unknownCalls"
        from ai_calls a where ${callScope} group by a.currency order by a.currency`);
      const groups = await tx.execute<AdminFinanceReport['groups'][number]>(sql`
        select ${group} as "entityId", a.currency,
          coalesce(sum(a.provider_cost_microunits) filter(where a.provider_cost_microunits >= 0),0)::text as "knownMicrounits",
          count(*)::text as calls, count(*) filter(where a.provider_cost_microunits is null or a.provider_cost_microunits < 0)::text as "unknownCalls"
        from ai_calls a join jobs j on j.tenant_id=a.tenant_id and j.id=a.job_id where ${callScope}
        group by ${group},a.currency order by count(*) desc,${group},a.currency limit 51`);
      const captured = await tx.execute<AdminFinanceReport['captured'][number]>(sql`
        select unit,sum(amount)::text as amount from usage_ledger
        where type='CAPTURE' and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz
          ${input.tenantId ? sql`and tenant_id=${input.tenantId}::uuid` : sql``}
        group by unit order by unit`);
      const [coverage] = await tx.execute<{ jobs: string; videos: string }>(sql`
        select count(*)::text as jobs,count(*) filter(where j.type='GENERATE_VIDEO')::text as videos
        from jobs j where j.created_at >= ${from}::timestamptz and j.created_at < ${to}::timestamptz
          ${input.tenantId ? sql`and j.tenant_id=${input.tenantId}::uuid` : sql``}
          and not exists(select 1 from ai_calls a where a.tenant_id=j.tenant_id and a.job_id=j.id and a.provider_cost_microunits >= 0)`);
      await tx.insert(auditLogs).values({ userId, action: 'ADMIN_FINANCE_READ', correlationId, metadata: { from, to, paymentMode: input.paymentMode, groupBy: input.groupBy, ...(input.tenantId ? { tenantId: input.tenantId } : {}) } });
      return { revenue: [...revenue], costs: [...costs], groups: [...groups].slice(0, 50), groupsTruncated: groups.length > 50, captured: [...captured], jobsWithoutCostEvidence: coverage?.jobs ?? '0', videoJobsWithoutCostEvidence: coverage?.videos ?? '0', grossMargin: null };
    }, { isolationLevel: 'repeatable read' });
  }
}
