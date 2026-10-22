import { expect, it } from 'vitest';
import { postSchema, postPublicationText, postHistoryQuerySchema } from '../packages/types/src/index';
it('validates post output and exports only public body/hashtags',()=>{
  const post=postSchema.parse({title:'Internal',body:'Public text',hashtags:['учёба','practice'],factCheckNotes:['Internal note']});
  expect(postPublicationText(post)).toBe('Public text\n\n#учёба #practice');
  for(const patch of [{body:' '},{body:'x'.repeat(16001)},{hashtags:['#tag']},{hashtags:['two words']},{extra:'invalid'}])expect(postSchema.safeParse({...post,...patch}).success).toBe(false);
});

it('validates bounded post-history cursors without coercing ambiguous values',()=>{
  expect(postHistoryQuerySchema.parse({})).toEqual({});expect(postHistoryQuerySchema.parse({before:'21'})).toEqual({before:21});
  for(const before of ['0','-1','01','1.5','1e2',' 2','2147483648',2,null])expect(postHistoryQuerySchema.safeParse({before}).success).toBe(false);
  expect(postHistoryQuerySchema.safeParse({before:'2',extra:true}).success).toBe(false);
});
