import {z} from 'zod';
export const captionSegmentSchema=z.object({start:z.number().finite().min(0),end:z.number().finite().positive(),text:z.string().trim().min(1).max(500)}).strict().refine(segment=>segment.end>segment.start);
export const videoProcessingSchema=z.object({
  orientation:z.enum(['9:16','1:1','16:9']).default('9:16'),resolution:z.enum(['720p','1080p']).default('1080p'),fit:z.enum(['crop','contain']).default('crop'),
  captionStyle:z.enum(['clean','bold']).default('clean'),captions:z.array(captionSegmentSchema).max(300).default([]),
}).strict().superRefine((input,ctx)=>{for(let i=1;i<input.captions.length;i++)if(input.captions[i]!.start<input.captions[i-1]!.end)ctx.addIssue({code:'custom',path:['captions',i],message:'Captions must be ordered without overlap'});});
export type VideoProcessingOptions=z.infer<typeof videoProcessingSchema>;
export function videoDimensions(orientation:VideoProcessingOptions['orientation'],resolution:VideoProcessingOptions['resolution']){
  const short=resolution==='720p'?720:1080,long=resolution==='720p'?1280:1920;
  return orientation==='1:1'?{width:short,height:short}:orientation==='9:16'?{width:short,height:long}:{width:long,height:short};
}
