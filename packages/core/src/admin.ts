import { AdminRepository, type AdminFinanceRepository } from '@contentos/db';
import { DomainError, adminFinanceSchema, adminPlanSchema, adminListSchema, adminRevokeSessionsSchema } from '@contentos/types';
export type AdminProviderConfiguration = { name: string; provider: string; model: string | null; status: 'CONFIGURED' | 'CONFIGURATION_REQUIRED' | 'DISABLED' };
export class AdminService {
  constructor(private readonly repository: AdminRepository, private readonly enabled: boolean, private readonly configuration: readonly AdminProviderConfiguration[], private readonly financeRepository?: AdminFinanceRepository) {}
  private ready() { if (!this.enabled) throw new DomainError('CONFIGURATION_REQUIRED', 503); }
  async canAccess(userId: string) {
    if (!this.enabled) return false;
    try { await this.repository.identity(userId); return true; }
    catch (error) { if (error instanceof DomainError && error.code === 'NOT_AUTHORIZED') return false; throw error; }
  }
  async overview(userId: string, correlationId: string) { this.ready(); const operator = await this.repository.access(userId, correlationId); return { role: operator.role, configuration: this.configuration }; }
  list(userId: string, raw: unknown, correlationId: string) { this.ready(); return this.repository.list(userId, adminListSchema.parse(raw), correlationId); }
  finance(userId: string, raw: unknown, correlationId: string) { this.ready(); if (!this.financeRepository) throw new DomainError('CONFIGURATION_REQUIRED', 503); return this.financeRepository.report(userId, adminFinanceSchema.parse(raw), correlationId); }
  catalog(userId: string, correlationId: string) { this.ready(); return this.repository.catalog(userId, correlationId); }
  publishPlan(userId: string, raw: unknown, correlationId: string) { this.ready(); return this.repository.publishPlan(userId, adminPlanSchema.parse(raw), correlationId); }
  revokeSessions(userId: string, raw: unknown, correlationId: string) { this.ready(); return this.repository.revokeSessions(userId, adminRevokeSessionsSchema.parse(raw), correlationId); }
}
