import { expect, it } from 'vitest';
import { postSchema, postPublicationText } from '../packages/types/src/index';
it('validates post output and exports only public body/hashtags',()=>{
  const post=postSchema.parse({title:'Internal',body:'Public text',hashtags:['учёба','practice'],factCheckNotes:['Internal note']});
  expect(postPublicationText(post)).toBe('Public text\n\n#учёба #practice');
  for(const patch of [{body:' '},{body:'x'.repeat(16001)},{hashtags:['#tag']},{hashtags:['two words']},{extra:'invalid'}])expect(postSchema.safeParse({...post,...patch}).success).toBe(false);
});
