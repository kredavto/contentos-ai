import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {BrandRepository,ContentRepository,JobRepository,LedgerRepository} from '../packages/db/src/index';
import {GenerationService} from '../packages/core/src/generation';
it('validates each script-detail identifier before repository access',()=>{
  const currentScript=vi.fn();
  const service=new GenerationService({} as JobRepository,{} as BrandRepository,{} as LedgerRepository,{currentScript} as unknown as ContentRepository,{provider:'unconfigured',model:'',ready:false});
  const user=randomUUID(),ids:[string,string,string]=[randomUUID(),randomUUID(),randomUUID()];
  for(let index=0;index<ids.length;index++){
    const bad:[string,string,string]=[...ids];bad[index]='invalid';
    expect(()=>service.currentScript(user,...bad)).toThrow();
  }
  expect(currentScript).not.toHaveBeenCalled();
  service.currentScript(user,...ids);expect(currentScript).toHaveBeenCalledExactlyOnceWith(user,...ids);
});
