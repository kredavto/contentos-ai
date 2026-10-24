import {randomBytes,randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {providerKeyInputSchema,providerKeyRevisionSchema} from '../packages/types/src/provider-keys';
import {CredentialVault} from '../packages/core/src/credential-vault';
it('validates provider-key boundaries without accepting caller-selected identities',()=>{
 const input={provider:'heygen',apiKey:'fixture-credential-123456',revision:null};expect(providerKeyInputSchema.parse(input)).toEqual(input);
 for(const changed of [{apiKey:'short'},{apiKey:'fixture key containing spaces'},{apiKey:'fixture-credential-123\n456'},{provider:'unknown'},{userId:randomUUID()},{revision:-1}])expect(providerKeyInputSchema.safeParse({...input,...changed}).success).toBe(false);
 expect(providerKeyRevisionSchema.safeParse({revision:2147483647}).success).toBe(false);
});
it('rotates the BYOK encryption envelope without changing its scoped plaintext',()=>{
 const old=randomBytes(32).toString('base64'),next=randomBytes(32).toString('base64'),scope={kind:'PROVIDER_KEY' as const,tenantId:randomUUID(),brandId:randomUUID(),connectionId:randomUUID(),provider:'heygen' as const};
 const encrypted=new CredentialVault(JSON.stringify({old}),'old').encrypt('fixture-only-key-123456',scope),rotating=new CredentialVault(JSON.stringify({old,next}),'next');
 const wrapped=rotating.rewrap(encrypted,scope);expect(wrapped.keyId).toBe('next');expect(new CredentialVault(JSON.stringify({next}),'next').decrypt(wrapped,scope)).toBe('fixture-only-key-123456');
 expect(()=>new CredentialVault(JSON.stringify({next}),'next').decrypt(encrypted,scope)).toThrow('CONFIGURATION_REQUIRED');
});
