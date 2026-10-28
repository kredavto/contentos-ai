import {describe,expect,it} from 'vitest';
import {searchResultLink} from '../apps/web/src/lib/search-result-link';
import type {SearchPage} from '../packages/types/src/index';
const item={id:'script-id',brandId:'brand-id',brandName:'Brand',title:'Title',excerpt:'Excerpt'};
describe('search result destinations',()=>{
  it('opens the exact script without changing other result destinations',()=>{
    expect(searchResultLink({...item,kind:'SCRIPT'},'tenant-id')).toEqual({href:'/brands/brand-id/scripts/script-id?organization=tenant-id',label:'Открыть сценарий'});
    for(const [kind,path] of [['BRAND','onboarding'],['IDEA','content?organization=tenant-id&tab=ideas'],['CONTENT','content?organization=tenant-id&tab=calendar'],['PUBLICATION','content?organization=tenant-id&tab=publishing']] as const){
      const result=searchResultLink({...item,kind} as SearchPage['items'][number],'tenant-id');expect(result.label).toBe('Открыть раздел бренда');expect(result.href).toBe(`/brands/brand-id/${path}${kind==='BRAND'?'?organization=tenant-id':''}`);
    }
  });
});
