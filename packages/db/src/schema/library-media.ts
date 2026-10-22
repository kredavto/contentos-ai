import {sql} from 'drizzle-orm';
import {pgTable,uuid,text,integer,boolean,timestamp,unique,index,foreignKey,check} from 'drizzle-orm/pg-core';
import {brands,users} from './identity';

export const libraryMedia=pgTable('library_media',{
  id:uuid('id').primaryKey().defaultRandom(),tenantId:uuid('tenant_id').notNull(),brandId:uuid('brand_id').notNull(),
  uploadedBy:uuid('uploaded_by').notNull().references(()=>users.id),name:text('name').notNull(),provider:text('provider').notNull(),
  status:text('status',{enum:['UPLOADING','QUEUED','RUNNING','READY','FAILED','DELETE_PENDING','DELETED']}).notNull().default('UPLOADING'),
  sourceKey:text('source_key').notNull().unique(),sourceMime:text('source_mime',{enum:['video/mp4','audio/mpeg','audio/wav']}).notNull(),sourceBytes:integer('source_bytes').notNull(),sourceSha256:text('source_sha256').notNull(),
  uploadExpiresAt:timestamp('upload_expires_at',{withTimezone:true}).notNull(),
  chunkHashes:text('chunk_hashes').array().notNull().default(sql`'{}'::text[]`),uploadedChunks:integer('uploaded_chunks').array().notNull().default(sql`'{}'::integer[]`),
  storageKey:text('storage_key').unique(),mimeType:text('mime_type'),bytes:integer('bytes'),durationMs:integer('duration_ms'),width:integer('width'),height:integer('height'),hasAudio:boolean('has_audio'),
  inputHash:text('input_hash').notNull(),idempotencyKey:uuid('idempotency_key').notNull(),correlationId:uuid('correlation_id').notNull(),
  attempt:integer('attempt').notNull().default(0),leaseToken:uuid('lease_token'),leaseExpiresAt:timestamp('lease_expires_at',{withTimezone:true}),
  nextAttemptAt:timestamp('next_attempt_at',{withTimezone:true}).notNull().defaultNow(),dispatchAfter:timestamp('dispatch_after',{withTimezone:true}).notNull().defaultNow(),errorCode:text('error_code'),
  cleanupAfter:timestamp('cleanup_after',{withTimezone:true}),cleanupUntil:timestamp('cleanup_until',{withTimezone:true}),cleanupToken:uuid('cleanup_token'),cleanupExpiresAt:timestamp('cleanup_expires_at',{withTimezone:true}),cleanupAttempts:integer('cleanup_attempts').notNull().default(0),
  createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),finishedAt:timestamp('finished_at',{withTimezone:true}),deletedAt:timestamp('deleted_at',{withTimezone:true}),
},t=>[
  unique('library_media_tenant_id_uq').on(t.tenantId,t.id),unique('library_media_intent_uq').on(t.tenantId,t.idempotencyKey),
  index('library_media_brand_idx').on(t.tenantId,t.brandId,t.createdAt),index('library_media_dispatch_idx').on(t.status,t.dispatchAfter),index('library_media_cleanup_idx').on(t.provider,t.cleanupAfter),
  foreignKey({columns:[t.tenantId,t.brandId],foreignColumns:[brands.tenantId,brands.id]}),
  check('library_media_status_valid',sql`${t.status} in ('UPLOADING','QUEUED','RUNNING','READY','FAILED','DELETE_PENDING','DELETED')`),
  check('library_media_source_valid',sql`${t.sourceMime} in ('video/mp4','audio/mpeg','audio/wav') and ${t.sourceBytes} between 12 and 67108864 and ${t.sourceSha256} ~ '^[a-f0-9]{64}$' and ${t.inputHash} ~ '^[a-f0-9]{64}$'`),
  check('library_media_chunks_valid',sql`cardinality(${t.chunkHashes}) between 0 and 22 and (cardinality(${t.chunkHashes}) = 0 or (array_ndims(${t.chunkHashes}) = 1 and array_lower(${t.chunkHashes},1) = 1 and cardinality(${t.chunkHashes}) = ((${t.sourceBytes} + 3145727) / 3145728) and array_position(${t.chunkHashes},null) is null and array_to_string(${t.chunkHashes},',') ~ '^[a-f0-9]{64}(,[a-f0-9]{64})*$'))`),
  check('library_media_chunk_receipts_valid',sql`cardinality(${t.uploadedChunks}) <= cardinality(${t.chunkHashes}) and (cardinality(${t.uploadedChunks}) = 0 or (array_ndims(${t.uploadedChunks}) = 1 and array_lower(${t.uploadedChunks},1) = 1 and array_position(${t.uploadedChunks},null) is null and 0 <= all(${t.uploadedChunks}) and cardinality(${t.chunkHashes}) > all(${t.uploadedChunks})))`),
  check('library_media_key_valid',sql`${t.sourceKey} = ${t.tenantId}::text || '/uploads/' || ${t.id}::text || '/source' and (${t.storageKey} is null or ${t.storageKey} like ${t.tenantId}::text || '/library/' || ${t.id}::text || '/%')`),
  check('library_media_attempt_valid',sql`${t.attempt} between 0 and 3 and ${t.cleanupAttempts} >= 0`),
  check('library_media_lease_valid',sql`(${t.status} = 'RUNNING') = (${t.leaseToken} is not null and ${t.leaseExpiresAt} is not null)`),
  check('library_media_ready_valid',sql`${t.status} <> 'READY' or (${t.storageKey} is not null and ${t.bytes} between 12 and 67108864 and ${t.durationMs} between 1 and 180500 and ${t.hasAudio} is not null and ((${t.sourceMime} = 'video/mp4' and ${t.mimeType} = 'video/mp4' and ${t.width} between 2 and 1920 and ${t.height} between 2 and 1920) or (${t.sourceMime} <> 'video/mp4' and ${t.mimeType} = 'audio/mpeg' and ${t.width} is null and ${t.height} is null and ${t.hasAudio}))) is true`),
]);
