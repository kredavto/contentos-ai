import { z } from 'zod';
export const maxPhotoUploadBytes = 3 * 1024 * 1024;
export const photoMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const mediaUploadSchema = z.object({
  name: z.string().trim().min(1).max(160).refine(value => Array.from(value).every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)),
  mimeType: z.enum(photoMimeTypes), idempotencyKey: z.uuid(),
}).strict();
export type MediaUpload = z.infer<typeof mediaUploadSchema>;
export type MediaStatus = 'UPLOADING' | 'READY' | 'DELETE_PENDING' | 'DELETED';
