import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {BrandRepository,ContentRepository,JobRepository,LedgerRepository} from '../packages/db/src/index';
import {GenerationService} from '../packages/core/src/generation';
it('validates each idea-detail identifier before repository access',()=>{
  const currentIdea=vi.fn();
  const service=new GenerationService({} as JobRepository,{} as BrandRepository,{} as LedgerRepository,{currentIdea} as unknown as ContentRepository,{provider:'unconfigured',model:'',ready:false});
  const user=randomUUID(),ids:[string,string,string]=[randomUUID(),randomUUID(),randomUUID()];
  for(let index=0;index<ids.length;index++){
    const bad:[string,string,string]=[...ids];bad[index]='invalid';
    expect(()=>service.currentIdea(user,...bad)).toThrow();
  }
  expect(currentIdea).not.toHaveBeenCalled();
  service.currentIdea(user,...ids);expect(currentIdea).toHaveBeenCalledExactlyOnceWith(user,...ids);
});
it('propagates repository denial and unexpected failure without substituting another idea',async()=>{
  const currentIdea=vi.fn();
  const service=new GenerationService({} as JobRepository,{} as BrandRepository,{} as LedgerRepository,{currentIdea} as unknown as ContentRepository,{provider:'unconfigured',model:'',ready:false});
  const args:[string,string,string,string]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  for(const error of [new Error('NOT_FOUND'),new Error('CONFIGURATION_REQUIRED')]){
    currentIdea.mockRejectedValueOnce(error);await expect(service.currentIdea(...args)).rejects.toBe(error);
  }
  expect(currentIdea).toHaveBeenCalledTimes(2);
});
