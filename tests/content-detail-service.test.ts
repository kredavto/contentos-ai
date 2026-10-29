import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {BrandRepository,ContentRepository,JobRepository,LedgerRepository} from '../packages/db/src/index';
import {GenerationService} from '../packages/core/src/generation';
it('validates each content-detail identifier before repository access',()=>{
  const currentContent=vi.fn();
  const service=new GenerationService({} as JobRepository,{} as BrandRepository,{} as LedgerRepository,{currentContent} as unknown as ContentRepository,{provider:'unconfigured',model:'',ready:false});
  const user=randomUUID(),ids:[string,string,string]=[randomUUID(),randomUUID(),randomUUID()];
  for(let index=0;index<ids.length;index++){
    const bad:[string,string,string]=[...ids];bad[index]='invalid';
    expect(()=>service.currentContent(user,...bad)).toThrow();
  }
  expect(currentContent).not.toHaveBeenCalled();
  service.currentContent(user,...ids);expect(currentContent).toHaveBeenCalledExactlyOnceWith(user,...ids);
});
it('propagates repository denial and unexpected failure without substituting another material',async()=>{
  const currentContent=vi.fn();
  const service=new GenerationService({} as JobRepository,{} as BrandRepository,{} as LedgerRepository,{currentContent} as unknown as ContentRepository,{provider:'unconfigured',model:'',ready:false});
  const args:[string,string,string,string]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  for(const error of [new Error('NOT_FOUND'),new Error('CONFIGURATION_REQUIRED')]){
    currentContent.mockRejectedValueOnce(error);await expect(service.currentContent(...args)).rejects.toBe(error);
  }
  expect(currentContent).toHaveBeenCalledTimes(2);
});
