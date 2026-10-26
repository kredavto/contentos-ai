import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {FeaturePolicyService} from '../packages/core/src/feature-policy';
import {featurePolicyChangeSchema} from '../packages/types/src/index';
it('validates exact scopes, UUID targets and explicit rollout modes without accepting unknown fields',()=>{
 const repository={overview:vi.fn(),inspect:vi.fn(),change:vi.fn()},service=new FeaturePolicyService(repository,true),actor=randomUUID(),correlation=randomUUID(),raw={feature:'comments',scope:'GLOBAL',targetId:null,mode:'DISABLED',expectedRevision:0,ticket:'POLICY-1',idempotencyKey:randomUUID()};
 for(const patch of [{scope:'GLOBAL',targetId:randomUUID()},{scope:'USER',targetId:null},{feature:'unknown'},{force:true},{mode:true},{ticket:'private words'},{expectedRevision:-1}])expect(()=>service.change(actor,{...raw,...patch},correlation)).toThrow();
 expect(repository.change).not.toHaveBeenCalled();service.change(actor,raw,correlation);expect(repository.change).toHaveBeenCalledWith(actor,raw,correlation);
 expect(featurePolicyChangeSchema.safeParse({...raw,scope:'USER',targetId:randomUUID()}).success).toBe(true);
});
it('requires the platform admin environment switch for operator actions but not own effective policy reads',()=>{
 const repository={overview:vi.fn(),inspect:vi.fn(),change:vi.fn()},service=new FeaturePolicyService(repository,false),actor=randomUUID(),tenant=randomUUID(),correlation=randomUUID();
 expect(()=>service.inspect(actor,{feature:'comments',scope:'GLOBAL',targetId:null},correlation)).toThrow('CONFIGURATION_REQUIRED');expect(()=>service.change(actor,{},correlation)).toThrow('CONFIGURATION_REQUIRED');expect(repository.inspect).not.toHaveBeenCalled();expect(repository.change).not.toHaveBeenCalled();
 service.overview(actor,tenant);expect(repository.overview).toHaveBeenCalledWith(actor,tenant);
});
