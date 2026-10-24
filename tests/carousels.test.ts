import { expect, it } from 'vitest';
import { carouselSchema, carouselHistoryQuerySchema, carouselEditSchema, carouselLifecycleSchema, carouselExportQuerySchema, carouselPublicationText } from '../packages/types/src/index';
it('validates bounded slides/design and exports only the public caption',()=>{
 const value={title:'Internal',slides:[{heading:'One',body:'Text'},{heading:'Two',body:'Text'}],caption:'Public',hashtags:['учёба'],factCheckNotes:['Internal note'],design:{format:'SQUARE',font:'SANS',backgroundColor:'#ffffff',textColor:'#000000',accentColor:'#112233'}};
 const parsed=carouselSchema.parse(value);expect(carouselPublicationText(parsed)).toBe('Public\n\n#учёба');
 for(const patch of [{slides:[]},{slides:Array(11).fill(value.slides[0])},{slides:[{heading:'x'.repeat(101),body:'Text'},value.slides[1]]},{caption:' '},{design:{...value.design,backgroundColor:'url(https://example.com)'}},{extra:true}])expect(carouselSchema.safeParse({...value,...patch}).success).toBe(false);
});

it('validates archive state revisions and defaults only legacy edit requests',()=>{
  expect(carouselEditSchema.parse({revision:1,content:null}).lifecycleRevision).toBe(0);
  const input={revision:1,lifecycleRevision:0,archived:true};expect(carouselLifecycleSchema.parse(input)).toEqual(input);
  for(const patch of [{revision:0},{lifecycleRevision:-1},{lifecycleRevision:1.5},{archived:'true'},{extra:true}])expect(carouselLifecycleSchema.safeParse({...input,...patch}).success).toBe(false);
  expect(carouselLifecycleSchema.safeParse({revision:1,archived:true}).success).toBe(false);
});

it('requires explicit bounded export query revisions',()=>{
  expect(carouselExportQuerySchema.parse({revision:'2',lifecycleRevision:'0'})).toEqual({revision:2,lifecycleRevision:0});
  for(const input of [{revision:'0',lifecycleRevision:'0'},{revision:'1'},{revision:'1',lifecycleRevision:''},{revision:'1',lifecycleRevision:'-1'},{revision:'1.2',lifecycleRevision:'0'},{revision:'9007199254740992',lifecycleRevision:'0'},{revision:'1',lifecycleRevision:'0',extra:'x'}])expect(carouselExportQuerySchema.safeParse(input).success).toBe(false);
});

it('validates the optional bounded history cursor without accepting pagination overrides',()=>{
  expect(carouselHistoryQuerySchema.parse({})).toEqual({});
  expect(carouselHistoryQuerySchema.parse({before:'21'})).toEqual({before:21});
  for(const input of [{before:'0'},{before:'-1'},{before:'1.5'},{before:''},{before:'01'},{before:'2147483648'},{before:21},{before:'20',limit:'1000'}])expect(carouselHistoryQuerySchema.safeParse(input).success).toBe(false);
});
