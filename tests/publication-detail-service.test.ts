import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import type {PublishingRepository} from '../packages/db/src/index';
import {PublishingService} from '../packages/core/src/publishing';
import {DomainError} from '../packages/types/src/index';
it('validates every publication scope identifier before repository access',()=>{
  const publication=vi.fn(),service=new PublishingService({publication} as unknown as PublishingRepository,null,false);
  const user=randomUUID(),ids:[string,string,string]=[randomUUID(),randomUUID(),randomUUID()];
  for(let index=0;index<ids.length;index++){const bad:[string,string,string]=[...ids];bad[index]='invalid';expect(()=>service.publication(user,...bad)).toThrow();}
  expect(publication).not.toHaveBeenCalled();service.publication(user,...ids);expect(publication).toHaveBeenCalledExactlyOnceWith(user,...ids);
});
it('reads stored data with no provider configured and propagates denial/failure without fallback',async()=>{
  const publication=vi.fn(),service=new PublishingService({publication} as unknown as PublishingRepository,null,false);
  const args:[string,string,string,string]=[randomUUID(),randomUUID(),randomUUID(),randomUUID()],row={id:args[3]};
  publication.mockResolvedValueOnce(row);expect(await service.publication(...args)).toBe(row);
  for(const error of [new DomainError('NOT_FOUND',404),new Error('database unavailable')]){publication.mockRejectedValueOnce(error);await expect(service.publication(...args)).rejects.toBe(error);}
  expect(publication).toHaveBeenCalledTimes(3);
});
