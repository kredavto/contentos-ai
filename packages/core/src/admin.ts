import { AdminRepository } from '@contentos/db';
import { DomainError, adminListSchema, adminRevokeSessionsSchema } from '@contentos/types';
export type AdminProviderConfiguration = { name: string; provider: string; model: string | null; status: 'CONFIGURED' | 'CONFIGURATION_REQUIRED' | 'DISABLED' };
export class AdminService {
  constructor(private readonly repository: AdminRepository, private readonly enabled: boolean, private readonly configuration: readonly AdminProviderConfiguration[]) {}
  private ready() { if (!this.enabled) throw new DomainError('CONFIGURATION_REQUIRED', 503); }
  async canAccess(userId: string) {
    if (!this.enabled) return false;
    try { await this.repository.identity(userId); return true; }
    catch (error) { if (error instanceof DomainError && error.code === 'NOT_AUTHORIZED') return false; throw error; }
  }
  async overview(userId: string, correlationId: string) { this.ready(); const operator = await this.repository.access(userId, correlationId); return { role: operator.role, configuration: this.configuration }; }
  list(userId: string, raw: unknown, correlationId: string) { this.ready(); return this.repository.list(userId, adminListSchema.parse(raw), correlationId); }
  revokeSessions(userId: string, raw: unknown, correlationId: string) { this.ready(); return this.repository.revokeSessions(userId, adminRevokeSessionsSchema.parse(raw), correlationId); }
}
