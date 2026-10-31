import {z} from 'zod';
import type {OperationContext} from './providers';

export const maxMediaSourceBytes=64*1024*1024;
// Each same-origin request stays bounded, including chunked sources up to 64 MiB.
export const maxBrowserMediaBytes=3*1024*1024;
export const maxMediaChunks=Math.ceil(maxMediaSourceBytes/maxBrowserMediaBytes);
export const mediaChunkIndexSchema=z.number().int().min(0).max(maxMediaChunks-1);
const sha256Schema=z.string().regex(/^[a-f0-9]{64}$/);
export const mediaSourceMimeSchema=z.enum(['video/mp4','audio/mpeg','audio/wav']);
export type MediaSourceMime=z.infer<typeof mediaSourceMimeSchema>;
export const mediaSourceSchema=z.object({mimeType:mediaSourceMimeSchema,bytes:z.number().int().min(12).max(maxMediaSourceBytes),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const libraryUploadSchema=z.object({
  name:z.string().trim().min(1).max(160).refine(value=>Array.from(value).every(character=>character.charCodeAt(0)>=32&&character.charCodeAt(0)!==127)),
  source:mediaSourceSchema,idempotencyKey:z.uuid(),chunkHashes:z.array(sha256Schema).min(1).max(maxMediaChunks).optional(),
}).strict().refine(value=>!value.chunkHashes||value.chunkHashes.length===Math.ceil(value.source.bytes/maxBrowserMediaBytes),{message:'Chunk manifest must match the declared source size'});
export type LibraryUpload=z.infer<typeof libraryUploadSchema>;
export const libraryResumeSchema=z.object({id:z.uuid(),input:libraryUploadSchema,expiresAt:z.iso.datetime(),uploadedChunks:z.array(mediaChunkIndexSchema).max(maxMediaChunks).default([])}).strict();
export type LibraryResume=z.infer<typeof libraryResumeSchema>;
export const preparedMediaSchema=z.object({
  mimeType:z.enum(['video/mp4','audio/mpeg']),bytes:z.number().int().min(12).max(maxMediaSourceBytes),
  durationMs:z.number().int().min(1).max(180500),width:z.number().int().min(2).max(1920).nullable(),height:z.number().int().min(2).max(1920).nullable(),hasAudio:z.boolean(),
}).strict().refine(value=>value.mimeType==='video/mp4'?value.width!==null&&value.height!==null:value.width===null&&value.height===null&&value.hasAudio);
export type PreparedMedia=z.infer<typeof preparedMediaSchema>;
export interface DirectUploadProvider {
  signedUpload(input:{key:string;mimeType:MediaSourceMime;bytes:number;expiresSeconds:number},context:OperationContext):Promise<{url:string;fields:Record<string,string>;expiresInSeconds:number}>;
}
export interface MediaPreparationProvider {
  prepare(input:{bytes:Uint8Array;mimeType:MediaSourceMime},context:OperationContext):Promise<{bytes:Uint8Array;mimeType:'video/mp4'|'audio/mpeg';durationMs:number;width:number|null;height:number|null;hasAudio:boolean}>;
}
