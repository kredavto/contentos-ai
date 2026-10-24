import { describe, expect, it } from 'vitest';
import { validateSeedEnvironment } from '../packages/db/src/development-seed';
const env = { NODE_ENV: 'development', CONTENTOS_DEMO_SEED: 'true', DATABASE_URL: 'postgresql://localhost/contentos', CONTENTOS_DEMO_PASSWORD: 'synthetic-test-password' };
describe('development seed connection guard', () => {
  it('requires explicit opt-in and refuses production even with opt-in', () => {
    for (const patch of [{ NODE_ENV: 'production' }, { NODE_ENV: '' }, { CONTENTOS_DEMO_SEED: '' }, { CONTENTOS_DEMO_PASSWORD: 'short' }]) expect(() => validateSeedEnvironment({ ...env, ...patch })).toThrow();
    expect(validateSeedEnvironment(env).url).toBe(env.DATABASE_URL);
  });
  it('rejects remote, ambiguous and wrong-database URLs before connection', () => {
    for (const DATABASE_URL of ['postgresql://db.example.test/contentos', 'postgresql://localhost/customer', 'postgresql://localhost/contentos?host=db.example.test', 'postgresql://localhost/contentos#fragment', 'https://localhost/contentos', 'not a url']) expect(() => validateSeedEnvironment({ ...env, DATABASE_URL })).toThrow();
    expect(validateSeedEnvironment({ ...env, DATABASE_URL: 'postgresql://127.0.0.1/contentos_seed_test' }).url).toContain('contentos_seed_test');
  });
});
