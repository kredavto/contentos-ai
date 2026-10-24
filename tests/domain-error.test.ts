import { expect, it, vi } from 'vitest';
import { DomainError, ProviderRequestError } from '../packages/types/src/index';
it('recognizes branded domain errors across module reloads without broadening provider errors',async()=>{
  const old=new DomainError('NOT_AUTHORIZED',403);
  vi.resetModules();const reloaded=await import('../packages/types/src/index');
  expect(old instanceof reloaded.DomainError).toBe(true);expect(old instanceof reloaded.ProviderRequestError).toBe(false);
  expect(new ProviderRequestError('PROVIDER_UNAVAILABLE',503,false) instanceof reloaded.DomainError).toBe(true);
  expect({name:'DomainError',code:'NOT_AUTHORIZED',status:403} instanceof reloaded.DomainError).toBe(false);
  expect(new Error('NOT_AUTHORIZED') instanceof reloaded.DomainError).toBe(false);
});
