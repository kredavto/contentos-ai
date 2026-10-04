import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {DomainError,type EncryptedCredential} from '@contentos/types';
const keyIdSchema=z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/);
const scopeSchema=z.object({tenantId:z.uuid(),brandId:z.uuid(),connectionId:z.uuid(),provider:z.string().min(1).max(50)}).strict();
export type CredentialScope=z.infer<typeof scopeSchema>;
const paymentScopeSchema=z.object({kind:z.literal('PAYMENT_METHOD'),tenantId:z.uuid(),methodId:z.uuid(),provider:z.string().min(1).max(50),merchantId:z.string().min(1).max(128),test:z.boolean()}).strict();
export type PaymentMethodScope=z.infer<typeof paymentScopeSchema>;
type VaultScope=CredentialScope|PaymentMethodScope;
const envelopeSchema=z.object({version:z.literal(1),keyId:keyIdSchema,iv:z.string().max(24),tag:z.string().max(32),ciphertext:z.string().min(1).max(24000)}).strict();
function decode(value:string,size?:number){const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value||(size!==undefined&&bytes.length!==size))throw new Error('Invalid encoding');return bytes;}
export class CredentialVault{
  private readonly keys=new Map<string,Buffer>();
  constructor(keyring:string,private readonly activeKeyId:string){
    try{const parsed=z.record(keyIdSchema,z.string().max(100)).parse(JSON.parse(keyring));if(Object.keys(parsed).length<1||Object.keys(parsed).length>8)throw new Error('Invalid key count');for(const [id,key] of Object.entries(parsed))this.keys.set(id,decode(key,32));if(!this.keys.has(keyIdSchema.parse(activeKeyId)))throw new Error('Missing active key');}
    catch{throw new DomainError('CONFIGURATION_REQUIRED',503);}
  }
  private aad(scope:VaultScope){if('kind' in scope){const checked=paymentScopeSchema.parse(scope);return Buffer.from(JSON.stringify({purpose:'contentos-payment-method',version:1,tenantId:checked.tenantId,methodId:checked.methodId,provider:checked.provider,merchantId:checked.merchantId,test:checked.test}));}const checked=scopeSchema.parse(scope);return Buffer.from(JSON.stringify({purpose:'contentos-social-credential',version:1,tenantId:checked.tenantId,brandId:checked.brandId,connectionId:checked.connectionId,provider:checked.provider}));}
  encrypt(secret:string,scope:VaultScope):EncryptedCredential{
    if(!secret||Buffer.byteLength(secret)>16000)throw new DomainError('INVALID_INPUT');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.keys.get(this.activeKeyId)!,iv);cipher.setAAD(this.aad(scope));
    const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return {version:1,keyId:this.activeKeyId,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  }
  decrypt(value:EncryptedCredential,scope:VaultScope){
    try{const envelope=envelopeSchema.parse(value),key=this.keys.get(envelope.keyId);if(!key)throw new Error('Unavailable key');const decipher=createDecipheriv('aes-256-gcm',key,decode(envelope.iv,12));decipher.setAAD(this.aad(scope));decipher.setAuthTag(decode(envelope.tag,16));const plaintext=Buffer.concat([decipher.update(decode(envelope.ciphertext)),decipher.final()]);if(!plaintext.length||plaintext.length>16000)throw new Error('Invalid secret');return plaintext.toString('utf8');}
    catch{throw new DomainError('CONFIGURATION_REQUIRED',503);}
  }
  rewrap(value:EncryptedCredential,scope:VaultScope){return this.encrypt(this.decrypt(value,scope),scope);}
}
export function credentialVaultFromEnvironment(env:{CREDENTIAL_ENCRYPTION_KEYS?:string;CREDENTIAL_ACTIVE_KEY_ID?:string}){if(!env.CREDENTIAL_ENCRYPTION_KEYS||!env.CREDENTIAL_ACTIVE_KEY_ID)return null;try{return new CredentialVault(env.CREDENTIAL_ENCRYPTION_KEYS,env.CREDENTIAL_ACTIVE_KEY_ID);}catch{return null;}}
