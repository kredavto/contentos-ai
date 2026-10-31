import {z} from 'zod';
export const searchKindSchema=z.enum(['BRAND','IDEA','SCRIPT','CONTENT','PUBLICATION']);
export const searchQuerySchema=z.object({
  q:z.string().trim().min(2).max(120),
  kind:searchKindSchema.optional(),
  afterKind:searchKindSchema.optional(),
  afterId:z.uuid().optional(),
}).strict().refine(value=>Boolean(value.afterKind)===Boolean(value.afterId),'Incomplete cursor');
export type SearchQuery=z.infer<typeof searchQuerySchema>;
export const searchItemSchema=z.object({id:z.uuid(),kind:searchKindSchema,brandId:z.uuid(),brandName:z.string(),title:z.string(),excerpt:z.string()}).strict();
export const searchPageSchema=z.object({items:z.array(searchItemSchema),next:z.object({afterKind:searchKindSchema,afterId:z.uuid()}).nullable()});
export type SearchPage=z.infer<typeof searchPageSchema>;
