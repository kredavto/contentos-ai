import { PrivacyRepository } from '@contentos/db';
import { DomainError, cancelAccountDeletionSchema, requestAccountDeletionSchema } from '@contentos/types';
import { verifyPassword } from './password';
export class PrivacyService {
  constructor(private readonly repository: PrivacyRepository) {}
  overview(userId: string) { return this.repository.overview(userId); }
  async request(userId: string, raw: unknown, correlationId: string) {
    const input = requestAccountDeletionSchema.parse(raw);
    const proof = await this.repository.passwordProof(userId);
    if (!await verifyPassword(input.password, proof)) throw new DomainError('NOT_AUTHORIZED', 403);
    return this.repository.request(userId, proof, input.idempotencyKey, correlationId);
  }
  cancel(userId: string, raw: unknown, correlationId: string) {
    const input = cancelAccountDeletionSchema.parse(raw);
    return this.repository.cancel(userId, input.requestId, input.revision, correlationId);
  }
}
