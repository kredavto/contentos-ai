import {z} from 'zod';
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** Optional design snapshot; omission preserves legacy first-frame thumbnails. */
export const coverDesignSchema=z.object({
  framePercent:z.number().int().min(0).max(95),
  headline:z.string().trim().min(1).max(80).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value),'Use a single line without control characters'),
  background:z.enum(['FRAME','SOLID']),font:z.enum(['SANS','BOLD','SERIF']),layout:z.enum(['TOP','CENTER','BOTTOM']),
  textColor:color,backgroundColor:color,
}).strict();
export type CoverDesign=z.infer<typeof coverDesignSchema>;
