import sharp from 'sharp';
import { DomainError, maxPhotoUploadBytes } from '@contentos/types';
/** Decode raster bytes, apply orientation, strip metadata, then encode a fresh JPEG. */
export async function normalizePhoto(bytes: Uint8Array, mimeType: string) {
  if (!bytes.byteLength || bytes.byteLength > maxPhotoUploadBytes) throw new DomainError('INVALID_MEDIA', 413);
  const header = Buffer.from(bytes.subarray(0,12));
  const rasterSignature = header.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])) || header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (header.subarray(0,4).toString() === 'RIFF' && header.subarray(8,12).toString() === 'WEBP');
  if (!rasterSignature) throw new DomainError('INVALID_MEDIA');
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning', animated: false }).timeout({ seconds: 10 });
    const metadata = await image.metadata();
    const formats: Record<string,string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    const mime = formats[metadata.format ?? ''];
    if (!mime || mime !== mimeType || (metadata.pages ?? 1) !== 1) throw new DomainError('INVALID_MEDIA');
    const { data, info } = await image.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true });
    if (data.byteLength > maxPhotoUploadBytes) throw new DomainError('INVALID_MEDIA', 413);
    return { bytes: data, width: info.width, height: info.height, mimeType: 'image/jpeg' as const };
  } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('INVALID_MEDIA'); }
}
