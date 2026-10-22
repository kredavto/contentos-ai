import { z } from 'zod';
export const postSchema = z.object({
  title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(16000),
  hashtags: z.array(z.string().regex(/^[\p{L}\p{N}_]{1,100}$/u)).max(30),
  factCheckNotes: z.array(z.string().min(1).max(2000)).max(20),
}).strict();
export type PostOutput = z.infer<typeof postSchema>;
export const postEditSchema = z.object({ revision: z.number().int().positive(), content: postSchema.nullable() }).strict();
export function postPublicationText(post: Pick<PostOutput, 'body' | 'hashtags'>) {
  return post.body + (post.hashtags.length ? '\n\n' + post.hashtags.map(tag => `#${tag}`).join(' ') : '');
}

export const postHistoryQuerySchema=z.object({before:z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(2147483647)).optional()}).strict();
export type PostHistoryQuery=z.infer<typeof postHistoryQuerySchema>;
