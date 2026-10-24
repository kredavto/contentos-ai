import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {searchQuerySchema} from '../packages/types/src/search';
it('bounds search input and requires complete typed cursors',()=>{
  expect(searchQuerySchema.parse({q:'  привет  '})).toEqual({q:'привет'});
  expect(searchQuerySchema.parse({q:'100%',afterKind:'BRAND',afterId:randomUUID()}).q).toBe('100%');
  for(const raw of [{q:''},{q:'a'},{q:' '.repeat(10)},{q:'a'.repeat(121)},{q:'ok',kind:'SECRET'},{q:'ok',afterId:randomUUID()},{q:'ok',afterKind:'BRAND'},{q:'ok',tenantId:randomUUID()}])expect(searchQuerySchema.safeParse(raw).success).toBe(false);
});
