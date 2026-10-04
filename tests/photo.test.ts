import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normalizePhoto } from '../packages/core/src/photo';
import { readPhotoUpload } from '../apps/web/src/server/api';
describe('photo upload boundary',()=>{
  it('decodes, orients and strips source metadata from a resized raster',async()=>{
    const input=await sharp({create:{width:2500,height:1000,channels:3,background:'#ff8000'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const normalized=await normalizePhoto(input,'image/jpeg');
    const metadata=await sharp(normalized.bytes).metadata();
    expect(metadata.format).toBe('jpeg');expect(metadata.width).toBe(819);expect(metadata.height).toBe(2048);
    expect(metadata.exif).toBeUndefined();expect(metadata.icc).toBeUndefined();expect(metadata.orientation).toBeUndefined();
  });
  it('rejects forged MIME, executable SVG, truncated bytes, oversized dimensions and oversized bodies',async()=>{
    const png=await sharp({create:{width:10,height:10,channels:3,background:'#fff'}}).png().toBuffer();
    await expect(normalizePhoto(png,'image/jpeg')).rejects.toThrow('INVALID_MEDIA');
    await expect(normalizePhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),'image/png')).rejects.toThrow('INVALID_MEDIA');
    await expect(normalizePhoto(png.subarray(0,30),'image/png')).rejects.toThrow('INVALID_MEDIA');
    const huge=await sharp({create:{width:5000,height:4000,channels:3,background:'#fff'}}).png().toBuffer();
    await expect(normalizePhoto(huge,'image/png')).rejects.toThrow('INVALID_MEDIA');
    const request=new Request('http://localhost/upload',{method:'POST',headers:{'content-type':'image/png','x-file-name':'test.png','idempotency-key':crypto.randomUUID()},body:Buffer.alloc(3*1024*1024+1)});
    await expect(readPhotoUpload(request)).rejects.toThrow('INVALID_MEDIA');
  });
});
