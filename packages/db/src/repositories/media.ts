import { randomUUID } from 'node:crypto';
import { and, eq, sql, desc } from 'drizzle-orm';
import { DomainError, type MediaUpload } from '@contentos/types';
import type { Database } from '../index';
import { mediaAssets, brands, auditLogs } from '../schema';
import { assertMembership, lockTenant, type Transaction } from './ledger';
export type StoredMedia = typeof mediaAssets.$inferSelect;
const whereAsset = (tenantId: string, id: string) => and(eq(mediaAssets.tenantId, tenantId), eq(mediaAssets.id, id));
async function requireBrand(tx: Transaction, tenantId: string, brandId: string) {
  const [brand] = await tx.select({ id: brands.id }).from(brands).where(and(eq(brands.tenantId, tenantId), eq(brands.id, brandId)));
  if (!brand) throw new DomainError('NOT_FOUND', 404);
}
export class MediaRepository {
  constructor(private readonly db: Database) {}
  async authorize(userId: string, tenantId: string, brandId: string) {
    await this.db.transaction(async tx => { await assertMembership(tx,userId,tenantId,'generate'); await requireBrand(tx,tenantId,brandId); });
  }
  async list(userId: string, tenantId: string, brandId: string) {
    return this.db.transaction(async tx => {
      await assertMembership(tx,userId,tenantId); await requireBrand(tx,tenantId,brandId);
      return tx.select({id:mediaAssets.id,name:mediaAssets.name,status:mediaAssets.status,mimeType:mediaAssets.mimeType,bytes:mediaAssets.bytes,width:mediaAssets.width,height:mediaAssets.height,createdAt:mediaAssets.createdAt,errorCode:mediaAssets.errorCode}).from(mediaAssets).where(and(eq(mediaAssets.tenantId,tenantId),eq(mediaAssets.brandId,brandId),sql`${mediaAssets.status} <> 'DELETED'`)).orderBy(desc(mediaAssets.createdAt)).limit(100);
    });
  }
  async begin(userId: string, tenantId: string, brandId: string, input: MediaUpload, image: { bytes: number; width: number; height: number; sha256: string; inputHash: string }, provider: string, correlationId: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx,tenantId); await assertMembership(tx,userId,tenantId,'generate'); await requireBrand(tx,tenantId,brandId);
      const [existing] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.tenantId,tenantId),eq(mediaAssets.idempotencyKey,input.idempotencyKey))).for('update');
      if (existing) {
        if (existing.inputHash !== image.inputHash || existing.brandId !== brandId || existing.uploadedBy !== userId || existing.provider !== provider) throw new DomainError('CONFLICT',409);
        if (existing.status === 'READY') return existing;
        if (existing.status !== 'UPLOADING' || (existing.leaseToken && existing.leaseExpiresAt && existing.leaseExpiresAt.getTime() > Date.now())) throw new DomainError('CONFLICT',409);
        const [claimed] = await tx.update(mediaAssets).set({leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+120_000),errorCode:null}).where(whereAsset(tenantId,existing.id)).returning();
        return claimed!;
      }
      // A conservative bootstrap quota includes in-flight uploads and pending deletion.
      const [usage] = await tx.select({bytes:sql<number>`coalesce(sum(${mediaAssets.bytes}),0)::float8`,count:sql<number>`count(*)::int`}).from(mediaAssets).where(and(eq(mediaAssets.tenantId,tenantId),sql`${mediaAssets.status} <> 'DELETED'`));
      if ((usage?.bytes ?? 0)+image.bytes > 1024*1024*1024 || (usage?.count ?? 0) >= 1000) throw new DomainError('PLAN_LIMIT_REACHED',403);
      const assetId = randomUUID();
      const [asset] = await tx.insert(mediaAssets).values({id:assetId,tenantId,brandId,uploadedBy:userId,name:input.name,provider,storageKey:`${tenantId}/${brandId}/photos/${assetId}.jpg`,mimeType:'image/jpeg',...image,idempotencyKey:input.idempotencyKey,leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+120_000),correlationId}).returning();
      if (!asset) throw new Error('Media insert failed');
      await tx.insert(auditLogs).values({tenantId,userId,action:'MEDIA_UPLOAD_REQUESTED',resourceId:asset.id,correlationId}); return asset;
    });
  }
  async complete(userId: string, asset: StoredMedia) {
    await this.db.transaction(async tx => {
      await lockTenant(tx,asset.tenantId); await assertMembership(tx,userId,asset.tenantId,'generate');
      const updated = await tx.update(mediaAssets).set({status:'READY',leaseToken:null,leaseExpiresAt:null,errorCode:null}).where(and(whereAsset(asset.tenantId,asset.id),eq(mediaAssets.status,'UPLOADING'),eq(mediaAssets.leaseToken,asset.leaseToken!),sql`${mediaAssets.leaseExpiresAt} > now()`)).returning({id:mediaAssets.id});
      if (!updated.length) throw new DomainError('CONFLICT',409);
      await tx.insert(auditLogs).values({tenantId:asset.tenantId,userId,action:'MEDIA_UPLOADED',resourceId:asset.id,correlationId:asset.correlationId});
    });
  }
  async failed(asset: StoredMedia, code: string) {
    await this.db.update(mediaAssets).set({leaseToken:null,errorCode:code}).where(and(whereAsset(asset.tenantId,asset.id),eq(mediaAssets.status,'UPLOADING'),eq(mediaAssets.leaseToken,asset.leaseToken!)));
  }
  async ready(userId: string, tenantId: string, brandId: string, id: string) {
    return this.db.transaction(async tx => {
      await assertMembership(tx,userId,tenantId);
      const [asset] = await tx.select().from(mediaAssets).where(and(whereAsset(tenantId,id),eq(mediaAssets.brandId,brandId),eq(mediaAssets.status,'READY')));
      if (!asset) throw new DomainError('NOT_FOUND',404); return asset;
    });
  }
  async requestDeletion(userId: string, tenantId: string, brandId: string, id: string, correlationId: string) {
    return this.db.transaction(async tx => {
      await lockTenant(tx,tenantId); await assertMembership(tx,userId,tenantId,'generate');
      const [asset] = await tx.select().from(mediaAssets).where(and(whereAsset(tenantId,id),eq(mediaAssets.brandId,brandId))).for('update');
      if (!asset) throw new DomainError('NOT_FOUND',404);
      if (asset.status === 'DELETED' || asset.status === 'DELETE_PENDING') return {status:asset.status};
      await tx.update(mediaAssets).set({status:'DELETE_PENDING',correlationId,deleteAfter:new Date(Math.max(Date.now(),(asset.leaseExpiresAt?.getTime() ?? 0)+60_000)),leaseToken:null,leaseExpiresAt:null,errorCode:null}).where(whereAsset(tenantId,id));
      await tx.insert(auditLogs).values({tenantId,userId,action:'MEDIA_DELETION_REQUESTED',resourceId:id,correlationId}); return {status:'DELETE_PENDING' as const};
    });
  }
  async claimCleanup(provider: string) {
    return this.db.transaction(async tx => {
      // Abandoned uploads become deletion jobs even if the HTTP process died.
      await tx.update(mediaAssets).set({status:'DELETE_PENDING',deleteAfter:sql`now()`,leaseToken:null,leaseExpiresAt:null}).where(and(eq(mediaAssets.provider,provider),eq(mediaAssets.status,'UPLOADING'),sql`${mediaAssets.createdAt} < now() - interval '24 hours'`,sql`(${mediaAssets.leaseExpiresAt} is null or ${mediaAssets.leaseExpiresAt} < now() - interval '1 minute')`));
      const [asset] = await tx.select().from(mediaAssets).where(and(eq(mediaAssets.provider,provider),sql`(${mediaAssets.status} = 'DELETE_PENDING' or (${mediaAssets.status} = 'DELETED' and ${mediaAssets.deletedAt} > now() - interval '24 hours'))`,sql`${mediaAssets.deleteAfter} <= now()`,sql`(${mediaAssets.leaseExpiresAt} is null or ${mediaAssets.leaseExpiresAt} < now())`)).for('update',{skipLocked:true}).limit(1);
      if (!asset) return null;
      const [claimed] = await tx.update(mediaAssets).set({leaseToken:randomUUID(),leaseExpiresAt:new Date(Date.now()+120_000),deleteAttempts:asset.deleteAttempts+1}).where(whereAsset(asset.tenantId,asset.id)).returning();return claimed ?? null;
    });
  }
  async finishCleanup(asset: StoredMedia, succeeded: boolean) {
    await this.db.transaction(async tx => {
      await lockTenant(tx,asset.tenantId);
      const updated = await tx.update(mediaAssets).set(succeeded ? {status:'DELETED',name:'[deleted]',sha256:'0'.repeat(64),deletedAt:asset.deletedAt ?? new Date(),deleteAfter:new Date(Date.now()+3_600_000),leaseToken:null,leaseExpiresAt:null,errorCode:null} : {errorCode:'PROVIDER_UNAVAILABLE',deleteAfter:new Date(Date.now()+Math.min(3_600_000,5000*2**Math.min(asset.deleteAttempts,10))),leaseToken:null,leaseExpiresAt:null}).where(and(whereAsset(asset.tenantId,asset.id),eq(mediaAssets.leaseToken,asset.leaseToken!),sql`${mediaAssets.leaseExpiresAt} > now()`)).returning({id:mediaAssets.id});
      if (!updated.length) throw new DomainError('CONFLICT',409);
      if (succeeded && !asset.deletedAt) await tx.insert(auditLogs).values({tenantId:asset.tenantId,action:'MEDIA_DELETED',resourceId:asset.id,correlationId:asset.correlationId});
    });
  }
}
