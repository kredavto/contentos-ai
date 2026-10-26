import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {AccountErasureRecoveryService} from '../packages/core/src/account-erasure-recovery';
it('requires the operator feature flag and strict acknowledgment of the original scope',()=>{
 const repository={retry:vi.fn()},actor=randomUUID(),job=randomUUID(),correlation=randomUUID(),input={expectedRecoveryId:null,idempotencyKey:randomUUID(),reason:'DEPENDENCIES_RESOLVED',ticket:'RECOVERY-1',acknowledgeOriginalScope:true};
 const service=new AccountErasureRecoveryService(repository,true);
 for(const body of [{...input,acknowledgeOriginalScope:false},{...input,scope:'ALL_DATA'},{...input,ticket:'private words'},{...input,expectedRecoveryId:'bad'}])expect(()=>service.retry(actor,job,body,correlation)).toThrow();
 expect(()=>new AccountErasureRecoveryService(repository,false).retry(actor,job,input,correlation)).toThrow('CONFIGURATION_REQUIRED');expect(repository.retry).not.toHaveBeenCalled();
 service.retry(actor,job,input,correlation);expect(repository.retry).toHaveBeenCalledWith(actor,job,input,correlation);
});
