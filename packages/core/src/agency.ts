import { z } from 'zod';
import { AgencyRepository } from '@contentos/db';
import { DomainError, agencyModeSchema, agencyClientSchema, agencyClientStateSchema } from '@contentos/types';
export class AgencyService {
  constructor(private readonly repository: AgencyRepository, private readonly enabled: boolean) {}
  private ready() { if (!this.enabled) throw new DomainError('CONFIGURATION_REQUIRED', 503); }
  overview(userId: string, tenantId: string) { this.ready(); return this.repository.overview(userId, z.uuid().parse(tenantId)); }
  setMode(userId: string, tenantId: string, raw: unknown, correlationId: string) { this.ready(); const input = agencyModeSchema.parse(raw); return this.repository.setMode(userId, z.uuid().parse(tenantId), input.enabled, input.revision, correlationId); }
  addClient(userId: string, tenantId: string, raw: unknown, correlationId: string) { this.ready(); return this.repository.addClient(userId, z.uuid().parse(tenantId), agencyClientSchema.parse(raw), correlationId); }
  setArchived(userId: string, tenantId: string, clientId: string, raw: unknown, correlationId: string) { this.ready(); const input = agencyClientStateSchema.parse(raw); return this.repository.setArchived(userId, z.uuid().parse(tenantId), z.uuid().parse(clientId), input.revision, input.archived, correlationId); }
}
