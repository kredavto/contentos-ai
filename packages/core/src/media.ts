import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MediaRepository, type StoredMedia } from '@contentos/db';
import { DomainError, mediaUploadSchema, type OperationContext, type StorageProvider } from '@contentos/types';
import { normalizePhoto } from './photo';
const uuid = z.uuid();
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const contextFor = (asset: StoredMedia, correlationId = asset.correlationId): OperationContext => ({tenantId:asset.tenantId,internalId:asset.id,idempotencyKey:asset.idempotencyKey,correlationId,signal:AbortSignal.timeout(60_000)});
export class MediaService {
  constructor(private readonly repository: MediaRepository, private readonly storage: StorageProvider | null, private readonly provider = 's3') {}
  async overview(userId: string, tenantId: string, brandId: string) {
    return {assets:await this.repository.list(userId,uuid.parse(tenantId),uuid.parse(brandId)),configuration:{ready:!!this.storage,provider:this.storage?this.provider:'disabled'}};
  }
  async authorizeUpload(userId: string, tenantId: string, brandId: string) {
    await this.repository.authorize(userId,uuid.parse(tenantId),uuid.parse(brandId));
    if (!this.storage) throw new DomainError('CONFIGURATION_REQUIRED',503);
  }
  async upload(userId: string, tenantId: string, brandId: string, raw: unknown, bytes: Uint8Array, correlationId: string) {
    await this.authorizeUpload(userId,tenantId,brandId);
    const input = mediaUploadSchema.parse(raw);
    const normalized = await normalizePhoto(bytes,input.mimeType);
    const asset = await this.repository.begin(userId,tenantId,brandId,input,{bytes:normalized.bytes.byteLength,width:normalized.width,height:normalized.height,sha256:hash(normalized.bytes),inputHash:hash(JSON.stringify({name:input.name,mimeType:input.mimeType,content:hash(bytes)}))},this.provider,correlationId);
    if (asset.status === 'READY') return {id:asset.id,status:asset.status};
    try {
      await this.storage!.put(asset.storageKey,normalized.bytes,normalized.mimeType,contextFor(asset));
      await this.repository.complete(userId,asset);
      return {id:asset.id,status:'READY' as const};
    } catch (error) {
      await this.repository.failed(asset,error instanceof DomainError?error.code:'PROVIDER_UNAVAILABLE');
      throw error instanceof DomainError?error:new DomainError('PROVIDER_UNAVAILABLE',503);
    }
  }
  async download(userId: string, tenantId: string, brandId: string, id: string, correlationId: string = randomUUID()) {
    const asset = await this.repository.ready(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id));
    if (!this.storage || asset.provider !== this.provider) throw new DomainError('CONFIGURATION_REQUIRED',503);
    return {url:await this.storage.signedDownload(asset.storageKey,60,contextFor(asset,correlationId)),expiresInSeconds:60};
  }
  delete(userId: string, tenantId: string, brandId: string, id: string, correlationId: string) {
    return this.repository.requestDeletion(userId,uuid.parse(tenantId),uuid.parse(brandId),uuid.parse(id),correlationId);
  }
  async cleanupOne() {
    if (!this.storage) return false;
    const asset = await this.repository.claimCleanup(this.provider); if (!asset) return false;
    let succeeded = false;
    try { await this.storage.delete(asset.storageKey,contextFor(asset)); succeeded = true; }
    catch { /* Persist retry below without exposing storage response bodies. */ }
    await this.repository.finishCleanup(asset,succeeded); return true;
  }
}
