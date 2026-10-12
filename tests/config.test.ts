import { expect, it } from 'vitest';
import { parseServerEnvironment, publicProductConfig } from '../packages/config/src/index';
it('refuses insecure production origin and omits secrets from public config', () => {
  expect(() => parseServerEnvironment({ NODE_ENV: 'production', APP_URL: 'http://example.test', DATABASE_URL: 'postgresql://localhost/db', REDIS_URL: 'redis://localhost:6379' })).toThrow();
  expect(publicProductConfig({ APP_NAME: 'Renamed product', API_KEY: 'not-public' })).toEqual({ name: 'Renamed product' });
});

it('rejects mock avatars in production',()=>{expect(()=>parseServerEnvironment({NODE_ENV:'production',APP_URL:'https://example.test',DATABASE_URL:'postgresql://localhost/db',REDIS_URL:'redis://localhost:6379',AVATAR_PROVIDER:'mock'})).toThrow();});

it('requires explicit valid receipt classifications without inventing defaults',()=>{
  const base={APP_URL:'https://example.test',DATABASE_URL:'postgresql://localhost/db',REDIS_URL:'redis://localhost:6379'};
  expect(parseServerEnvironment(base).PAYMENT_RECEIPT_VAT_CODE).toBeUndefined();
  expect(parseServerEnvironment({...base,PAYMENT_RECEIPT_VAT_CODE:'11',PAYMENT_RECEIPT_TAX_SYSTEM_CODE:'1',PAYMENT_RECEIPT_SUBJECT:'service'}).PAYMENT_RECEIPT_VAT_CODE).toBe('11');
  for(const invalid of [{PAYMENT_RECEIPT_VAT_CODE:'0'},{PAYMENT_RECEIPT_VAT_CODE:'1.5'},{PAYMENT_RECEIPT_TAX_SYSTEM_CODE:'7'},{PAYMENT_RECEIPT_SUBJECT:'guessed'}])expect(()=>parseServerEnvironment({...base,...invalid})).toThrow();
});
