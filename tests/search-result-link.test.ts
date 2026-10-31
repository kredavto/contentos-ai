import {describe,expect,it} from 'vitest';
import {searchResultLink} from '../apps/web/src/lib/search-result-link';
import type {SearchPage} from '../packages/types/src/index';
const item={id:'script-id',brandId:'brand-id',brandName:'Brand',title:'Title',excerpt:'Excerpt'};
describe('search result destinations',()=>{
  it('opens the exact script, idea, publication and content without changing other result destinations',()=>{
    expect(searchResultLink({...item,kind:'SCRIPT'},'tenant-id')).toEqual({href:'/brands/brand-id/scripts/script-id?organization=tenant-id',label:'Открыть сценарий'});
    expect(searchResultLink({...item,kind:'IDEA'},'tenant-id')).toEqual({href:'/brands/brand-id/ideas/script-id?organization=tenant-id',label:'Открыть идею'});
    expect(searchResultLink({...item,kind:'PUBLICATION'},'tenant-id')).toEqual({href:'/brands/brand-id/publications/script-id?organization=tenant-id',label:'Открыть публикацию'});
    expect(searchResultLink({...item,kind:'CONTENT'},'tenant-id')).toEqual({href:'/brands/brand-id/content/script-id?organization=tenant-id',label:'Открыть материал'});
    for(const [kind,path] of [['BRAND','onboarding']] as const){
      const result=searchResultLink({...item,kind} as SearchPage['items'][number],'tenant-id');expect(result.label).toBe('Открыть раздел бренда');expect(result.href).toBe(`/brands/brand-id/${path}${kind==='BRAND'?'?organization=tenant-id':''}`);
    }
  });
});
it('encodes exact IDEA path and organization components rather than allowing URL injection',()=>{
  expect(searchResultLink({...item,id:'id/?#',brandId:'brand/?#',kind:'IDEA'},'tenant&tab=other')).toEqual({href:'/brands/brand%2F%3F%23/ideas/id%2F%3F%23?organization=tenant%26tab%3Dother',label:'Открыть идею'});
});

it('encodes exact PUBLICATION path and organization components',()=>{
  expect(searchResultLink({...item,id:'id/?#',brandId:'brand/?#',kind:'PUBLICATION'},'tenant&tab=other')).toEqual({href:'/brands/brand%2F%3F%23/publications/id%2F%3F%23?organization=tenant%26tab%3Dother',label:'Открыть публикацию'});
});

it('encodes exact CONTENT path and organization components',()=>{
  expect(searchResultLink({...item,id:'id/?#',brandId:'brand/?#',kind:'CONTENT'},'tenant&tab=other')).toEqual({href:'/brands/brand%2F%3F%23/content/id%2F%3F%23?organization=tenant%26tab%3Dother',label:'Открыть материал'});
});
