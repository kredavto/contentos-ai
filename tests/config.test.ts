import { expect, it } from 'vitest';
import { parseServerEnvironment, publicProductConfig } from '../packages/config/src/index';
it('refuses insecure production origin and omits secrets from public config', () => {
  expect(() => parseServerEnvironment({ NODE_ENV: 'production', APP_URL: 'http://example.test', DATABASE_URL: 'postgresql://localhost/db', REDIS_URL: 'redis://localhost:6379' })).toThrow();
  expect(publicProductConfig({ APP_NAME: 'Renamed product', API_KEY: 'not-public' })).toEqual({ name: 'Renamed product' });
});

it('rejects mock avatars in production',()=>{expect(()=>parseServerEnvironment({NODE_ENV:'production',APP_URL:'https://example.test',DATABASE_URL:'postgresql://localhost/db',REDIS_URL:'redis://localhost:6379',AVATAR_PROVIDER:'mock'})).toThrow();});
