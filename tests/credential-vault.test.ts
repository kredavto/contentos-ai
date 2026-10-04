import {randomUUID,randomBytes} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {CredentialVault,credentialVaultFromEnvironment} from '../packages/core/src/credential-vault';
const scope=()=>({tenantId:randomUUID(),brandId:randomUUID(),connectionId:randomUUID(),provider:'telegram'});
describe('authenticated credential encryption',()=>{
  it('disables credential operations for missing or invalid configuration',()=>{
    expect(credentialVaultFromEnvironment({})).toBeNull();
    expect(credentialVaultFromEnvironment({CREDENTIAL_ENCRYPTION_KEYS:'invalid',CREDENTIAL_ACTIVE_KEY_ID:'v1'})).toBeNull();
    expect(credentialVaultFromEnvironment({CREDENTIAL_ENCRYPTION_KEYS:JSON.stringify({v1:randomBytes(32).toString('base64')}),CREDENTIAL_ACTIVE_KEY_ID:'v1'})).toBeInstanceOf(CredentialVault);
  });
  it('binds each ciphertext to its tenant, brand, connection and provider',()=>{
    const vault=new CredentialVault(JSON.stringify({v1:randomBytes(32).toString('base64')}),'v1'),context=scope(),secret='fixture-credential';
    const encrypted=vault.encrypt(secret,context);expect(JSON.stringify(encrypted)).not.toContain(secret);expect(vault.decrypt(encrypted,context)).toBe(secret);expect(vault.encrypt(secret,context).iv).not.toBe(encrypted.iv);
    for(const changed of [{tenantId:randomUUID()},{brandId:randomUUID()},{connectionId:randomUUID()},{provider:'different'}])expect(()=>vault.decrypt(encrypted,{...context,...changed})).toThrow('CONFIGURATION_REQUIRED');
    expect(()=>vault.decrypt({...encrypted,tag:Buffer.alloc(16).toString('base64')},context)).toThrow('CONFIGURATION_REQUIRED');
  });
  it('rotates without losing old credentials and rejects missing or malformed keys',()=>{
    const old=randomBytes(32).toString('base64'),next=randomBytes(32).toString('base64'),context=scope();const encrypted=new CredentialVault(JSON.stringify({old}),'old').encrypt('fixture',context);
    const rotating=new CredentialVault(JSON.stringify({old,next}),'next');const wrapped=rotating.rewrap(encrypted,context);expect(wrapped.keyId).toBe('next');expect(new CredentialVault(JSON.stringify({next}),'next').decrypt(wrapped,context)).toBe('fixture');
    expect(()=>new CredentialVault(JSON.stringify({next}),'next').decrypt(encrypted,context)).toThrow('CONFIGURATION_REQUIRED');
    expect(()=>new CredentialVault('{bad','old')).toThrow('CONFIGURATION_REQUIRED');expect(()=>new CredentialVault(JSON.stringify({old:'short'}),'old')).toThrow('CONFIGURATION_REQUIRED');
  });
});
