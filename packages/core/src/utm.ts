import { z } from 'zod';
import { UtmRepository } from '@contentos/db';
import { buildUtmUrl, utmCreateSchema, utmArchiveSchema, utmListSchema, DomainError } from '@contentos/types';
const uuid = z.uuid();
export class UtmService {
  constructor(private readonly repository: UtmRepository) {}
  list(userId: string, tenantId: string, brandId: string, raw: unknown) { return this.repository.list(userId, uuid.parse(tenantId), uuid.parse(brandId), utmListSchema.parse(raw)); }
  create(userId: string, tenantId: string, brandId: string, raw: unknown, correlationId: string) {
    const input = utmCreateSchema.parse(raw), { idempotencyKey: _key, ...fields } = input;
    const taggedUrl = buildUtmUrl(fields);
    if (taggedUrl.length > 4096) throw new DomainError('INVALID_INPUT');
    return this.repository.create(userId, uuid.parse(tenantId), uuid.parse(brandId), input, taggedUrl, correlationId);
  }
  archive(userId: string, tenantId: string, brandId: string, id: string, raw: unknown, correlationId: string) {
    const input = utmArchiveSchema.parse(raw);
    return this.repository.archive(userId, uuid.parse(tenantId), uuid.parse(brandId), uuid.parse(id), input.revision, input.archived, correlationId);
  }
}
