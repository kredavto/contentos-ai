import {z} from 'zod';
import {DomainError} from './index';
export const timeZoneSchema=z.string().min(1).max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Unknown time zone');
export function localMinute(instant:Date,timeZone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(instant);
  const get=(name:string)=>parts.find(part=>part.type===name)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
/** Resolve a wall-clock minute without silently shifting DST gaps or overlaps. */
export function calendarInstant(local:string,timeZone:string,disambiguation?:'EARLIER'|'LATER'){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)||!timeZoneSchema.safeParse(timeZone).success)throw new DomainError('INVALID_INPUT');
  const naive=new Date(`${local}:00.000Z`);
  if(!Number.isFinite(naive.getTime())||naive.toISOString().slice(0,16)!==local||naive.getUTCFullYear()<2000||naive.getUTCFullYear()>2100)throw new DomainError('INVALID_INPUT');
  const offsets=new Set<number>();
  for(let hours=-36;hours<=36;hours+=6){const sample=new Date(naive.getTime()+hours*3600000);offsets.add(new Date(`${localMinute(sample,timeZone)}:00Z`).getTime()-sample.getTime());}
  const candidates=[...offsets].map(offset=>new Date(naive.getTime()-offset)).filter(instant=>localMinute(instant,timeZone)===local).sort((a,b)=>a.getTime()-b.getTime());
  if(!candidates.length||(candidates.length>1&&!disambiguation))throw new DomainError('INVALID_INPUT');
  return disambiguation==='LATER'?candidates.at(-1)!:candidates[0]!;
}
export const calendarFieldsSchema=z.object({
  title:z.string().trim().min(1).max(200),type:z.enum(['SHORT_VIDEO','POST','CAROUSEL','STORY','IMAGE']),videoProjectId:z.uuid().nullable().default(null),
  platform:z.enum(['YOUTUBE','TIKTOK','INSTAGRAM','VK','TELEGRAM']),localDateTime:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),timeZone:timeZoneSchema,
  disambiguation:z.enum(['EARLIER','LATER']).optional(),caption:z.string().max(20000).default(''),hashtags:z.array(z.string().regex(/^[\p{L}\p{N}_]{1,100}$/u)).max(30).default([]),
  privacy:z.enum(['PUBLIC','UNLISTED','PRIVATE']).default('PUBLIC'),commentsEnabled:z.boolean().default(true),publishingMode:z.enum(['MANUAL','APPROVAL']).default('APPROVAL'),
}).strict();
export const calendarCreateSchema=calendarFieldsSchema.extend({idempotencyKey:z.uuid()});
export const calendarUpdateSchema=calendarFieldsSchema.extend({revision:z.number().int().nonnegative()});
export const calendarCancelSchema=z.object({revision:z.number().int().nonnegative()}).strict();
export const calendarWindowSchema=z.object({from:z.iso.datetime(),to:z.iso.datetime()}).strict().refine(value=>{const duration=Date.parse(value.to)-Date.parse(value.from);return duration>0&&duration<=62*86400000;});
export type CalendarFields=z.infer<typeof calendarFieldsSchema>;
export type CalendarCreate=z.infer<typeof calendarCreateSchema>;
export type CalendarUpdate=z.infer<typeof calendarUpdateSchema>;
