import {z} from 'zod';
import {brandBrainSchema} from './brand-brain';
const text=(max:number)=>z.string().max(max).refine(value=>!value.includes('\u0000'),'NUL is not permitted');
const nonempty=(max:number)=>text(max).refine(value=>value.trim().length>0,'Non-empty text required');
export const commentReplyRiskCategories=['LEGAL','MEDICAL','FINANCIAL','CONFLICT','COMPLAINT','PERSONAL_DATA','SENSITIVE','UNCERTAIN'] as const;
export const commentReplyInputSchema=z.object({
 brain:brandBrainSchema,brandRevision:z.number().int().nonnegative(),
 comment:z.object({id:z.uuid(),contentRevision:z.number().int().nonnegative(),reviewRevision:z.number().int().nonnegative(),text:text(10000),parentText:text(10000).nullable()}).strict(),
}).strict();
export type CommentReplyInput=z.infer<typeof commentReplyInputSchema>;
/** A suggestion cannot carry approval, publishing mode or provider identity. */
export const commentReplyOutputSchema=z.object({
 reply:nonempty(2000).nullable(),
 sentiment:z.enum(['POSITIVE','NEUTRAL','NEGATIVE']).nullable(),
 risks:z.array(z.object({category:z.enum(commentReplyRiskCategories),source:z.enum(['COMMENT','PARENT','CONTEXT']),quote:nonempty(1000).nullable(),reason:nonempty(2000)}).strict()).max(8),
}).strict();
export type CommentReplyOutput=z.infer<typeof commentReplyOutputSchema>;
export function validateCommentReply(raw:unknown,input:CommentReplyInput){
 return commentReplyOutputSchema.superRefine((output,ctx)=>{
  const categories=new Set<string>();
  for(const [index,risk] of output.risks.entries()){
   if(categories.has(risk.category))ctx.addIssue({code:'custom',path:['risks',index,'category'],message:'Duplicate risk category'});
   categories.add(risk.category);
   const source=risk.source==='COMMENT'?input.comment.text:risk.source==='PARENT'?input.comment.parentText:null;
   if(risk.source==='CONTEXT'?risk.quote!==null:!risk.quote||source===null||!source.includes(risk.quote))ctx.addIssue({code:'custom',path:['risks',index,'quote'],message:'Evidence must quote the selected source; context findings have no quote'});
  }
  if(output.reply===null&&output.risks.length===0)ctx.addIssue({code:'custom',path:['risks'],message:'A withheld suggestion requires an explanation'});
 }).safeParse(raw);
}
/** Advisory classification only: even a risk-free suggestion requires explicit approval. */
export function commentReplyReview(output:CommentReplyOutput){
 return {requiresApproval:true as const,requiresHuman:output.reply===null||output.risks.length>0,autoSendAllowed:false as const};
}
