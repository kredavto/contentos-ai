import {randomUUID} from 'node:crypto';
import {beforeAll,expect,it,vi} from 'vitest';
import {registerSchema} from '../packages/core/src/auth';
import {AccountErasureService} from '../packages/core/src/account-erasures';
import {hashPassword} from '../packages/core/src/password';
const password='Synthetic password for explicit erasure 123!';let hash='';beforeAll(async()=>{hash=await hashPassword(password);});
it('requires a new scoped irreversible consent and does not pass plaintext passwords to storage',async()=>{
 const user=randomUUID(),correlation=randomUUID(),repository={eligibility:vi.fn(),request:vi.fn().mockResolvedValue({id:randomUUID(),status:'QUEUED' as const})},privacy={passwordProof:vi.fn().mockResolvedValue(hash)},service=new AccountErasureService(repository,privacy,true);
 const input={password,requestId:randomUUID(),revision:randomUUID(),idempotencyKey:randomUUID(),scope:'ACCOUNT_AUTH_DATA_V1',acknowledgeIrreversible:true,acknowledgeRetainedEvidence:true};
 for(const raw of [{...input,scope:'ALL_ACCOUNT_DATA'},{...input,acknowledgeIrreversible:false},{...input,acknowledgeRetainedEvidence:false},{...input,password:'wrong'}])await expect(service.request(user,raw,correlation)).rejects.toThrow();
 expect(repository.request).not.toHaveBeenCalled();await service.request(user,input,correlation);
 expect(repository.request).toHaveBeenCalledWith(user,hash,{requestId:input.requestId,revision:input.revision,idempotencyKey:input.idempotencyKey},correlation);expect(JSON.stringify(repository.request.mock.calls)).not.toContain(password);
});
it('requires the deployment flag before checking a password or queuing execution',async()=>{
 const repository={eligibility:vi.fn(),request:vi.fn()},privacy={passwordProof:vi.fn()},service=new AccountErasureService(repository,privacy,false);
 await expect(service.request(randomUUID(),{password,requestId:randomUUID(),revision:randomUUID(),idempotencyKey:randomUUID(),scope:'ACCOUNT_AUTH_DATA_V1',acknowledgeIrreversible:true,acknowledgeRetainedEvidence:true},randomUUID())).rejects.toThrow('CONFIGURATION_REQUIRED');expect(privacy.passwordProof).not.toHaveBeenCalled();expect(repository.request).not.toHaveBeenCalled();
});

it('does not allow registration to reserve a future erased-profile address',()=>{
 const input={email:`deleted+${randomUUID()}@account.invalid`,name:'Fixture',password};
 expect(registerSchema.safeParse(input).success).toBe(false);expect(registerSchema.safeParse({...input,email:input.email.toUpperCase()}).success).toBe(false);
 expect(registerSchema.safeParse({...input,email:'ordinary@example.test'}).success).toBe(true);
});
