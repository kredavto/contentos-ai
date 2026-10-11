import {z} from 'zod';

/** Product bounds, independent of the selected image vendor. */
export const imageGenerationSchema=z.object({
  prompt:z.string().trim().min(1).max(4000).refine(value=>!/[\p{Cc}\p{Cf}]/u.test(value.replace(/\n/g,''))),
  width:z.union([z.literal(1024),z.literal(1536)]),
  height:z.union([z.literal(1024),z.literal(1536)]),
}).strict().refine(value=>value.width===1024||value.height===1024);
export type ImageGenerationInput=z.infer<typeof imageGenerationSchema>;
export const maxGeneratedImageBytes=24*1024*1024;
/** Missing vendor metering is unknown, never a measured zero. */
export interface ImageUsage {
  model:string;
  inputUnits:number|null;
  outputUnits:number|null;
  costMicrounits:number|null;
  currency:string;
}
