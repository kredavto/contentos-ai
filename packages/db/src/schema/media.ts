import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, integer, timestamp, unique, index, foreignKey, check } from 'drizzle-orm/pg-core';
import { brands, users } from './identity';
import type { MediaStatus } from '@contentos/types';
export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(), tenantId: uuid('tenant_id').notNull(), brandId: uuid('brand_id').notNull(),
  uploadedBy: uuid('uploaded_by').notNull().references(() => users.id), name: text('name').notNull(),
  kind: text('kind', { enum: ['PHOTO'] }).notNull().default('PHOTO'), status: text('status').$type<MediaStatus>().notNull().default('UPLOADING'),
  provider: text('provider').notNull(), storageKey: text('storage_key').notNull().unique(),
  mimeType: text('mime_type').notNull(), bytes: integer('bytes').notNull(), width: integer('width').notNull(), height: integer('height').notNull(),
  sha256: text('sha256').notNull(), inputHash: text('input_hash').notNull(), idempotencyKey: uuid('idempotency_key').notNull(),
  leaseToken: uuid('lease_token'), leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  deleteAttempts: integer('delete_attempts').notNull().default(0), deleteAfter: timestamp('delete_after', { withTimezone: true }), errorCode: text('error_code'),
  correlationId: uuid('correlation_id').notNull(), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(), deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, t => [unique('media_tenant_id_uq').on(t.tenantId, t.id), unique('media_upload_intent_uq').on(t.tenantId, t.idempotencyKey),
  index('media_brand_idx').on(t.tenantId, t.brandId, t.createdAt), index('media_cleanup_idx').on(t.status, t.deleteAfter),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),
  check('media_status_valid', sql`${t.status} in ('UPLOADING','READY','DELETE_PENDING','DELETED')`),
  check('media_photo_valid', sql`${t.kind} = 'PHOTO' and ${t.mimeType} = 'image/jpeg' and ${t.bytes} between 1 and 3145728 and ${t.width} between 1 and 2048 and ${t.height} between 1 and 2048`),
  check('media_key_tenant', sql`${t.storageKey} like ${t.tenantId}::text || '/%'`),
  check('media_hash_valid', sql`${t.sha256} ~ '^[a-f0-9]{64}$' and ${t.inputHash} ~ '^[a-f0-9]{64}$'`),
]);
