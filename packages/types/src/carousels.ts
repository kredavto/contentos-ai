import {z} from 'zod';
import {postSchema} from './posts';
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
const text=(limit:number)=>z.string().trim().min(1).max(limit).refine(value=>!/[\p{Cf}]/u.test(value),'Invisible formatting characters are not supported');
export const carouselSlideSchema=z.object({heading:text(100),body:text(600)}).strict();
export const carouselSchema=z.object({
  title:text(200),slides:z.array(carouselSlideSchema).min(2).max(10),caption:text(4000),
  hashtags:postSchema.shape.hashtags,factCheckNotes:postSchema.shape.factCheckNotes,
  design:z.object({format:z.enum(['SQUARE','PORTRAIT']),font:z.enum(['SANS','SERIF']),backgroundColor:color,textColor:color,accentColor:color}).strict(),
}).strict();
export type CarouselOutput=z.infer<typeof carouselSchema>;
export const carouselEditSchema=z.object({revision:z.number().int().positive(),content:carouselSchema.nullable()}).strict();
export function carouselPublicationText(content:Pick<CarouselOutput,'caption'|'hashtags'>){return content.caption+(content.hashtags.length?'\n\n'+content.hashtags.map(tag=>`#${tag}`).join(' '):'');}
