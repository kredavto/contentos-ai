import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {brollSelectionsSchema,videoRequestSchema,videoBrollSelections} from '../packages/types/src/videos';
const clip=(startMs:number,endMs:number)=>({assetId:randomUUID(),startMs,endMs,sourceStartMs:0,approved:true as const});
it('accepts adjacent intervals and rejects overlapping, unordered, unapproved or excessive selections',()=>{
  const first=clip(0,100),second=clip(100,200);
  expect(brollSelectionsSchema.parse([first,second])).toEqual([first,second]);
  for(const value of [[],[second,first],[first,clip(0,200)],[first,clip(99,200)],[{...first,approved:false}],[{...first,sourceStartMs:180000}],Array.from({length:6},(_,i)=>clip(i*100,(i+1)*100))])expect(brollSelectionsSchema.safeParse(value).success).toBe(false);
  expect(brollSelectionsSchema.parse(Array.from({length:5},(_,i)=>clip(i*100,(i+1)*100)))).toHaveLength(5);
});
it('keeps the legacy request shape and requires a single unambiguous representation',()=>{
  const input={scriptId:randomUUID(),scriptVersion:1,lookId:randomUUID(),orientation:'9:16',resolution:'720p',idempotencyKey:randomUUID(),broll:clip(0,100)};
  const legacy=videoRequestSchema.parse(input);expect(legacy).not.toHaveProperty('brollClips');expect(videoBrollSelections(legacy)).toEqual([input.broll]);
  expect(videoRequestSchema.safeParse({...input,brollClips:[input.broll]}).success).toBe(false);
  const {broll,...plain}=input;
  expect(videoBrollSelections(videoRequestSchema.parse(plain))).toEqual([]);
  expect(videoBrollSelections(videoRequestSchema.parse({...plain,brollClips:[broll,clip(100,200)]}))).toHaveLength(2);
});
it('bounds symmetric fades inside each clip without adding defaults to legacy selections',()=>{
  const selection=clip(200,800);
  expect(brollSelectionsSchema.parse([selection])[0]).not.toHaveProperty('fadeMs');
  for(const fadeMs of [100,300])expect(brollSelectionsSchema.parse([{...selection,fadeMs}])[0]?.fadeMs).toBe(fadeMs);
  for(const fadeMs of [0,-1,99,301,2001,100.5,NaN])expect(brollSelectionsSchema.safeParse([{...selection,fadeMs}]).success).toBe(false);
  expect(brollSelectionsSchema.safeParse([{...clip(0,4000),fadeMs:2000}]).success).toBe(true);
});
