import { expect, it } from 'vitest';
import { hashPassword, verifyPassword, createOpaqueToken, hashToken } from '../packages/core/src/password';
it('uses unique salts and verifies only correct passwords', async () => {
  const first = await hashPassword('correct-long-passphrase');
  const second = await hashPassword('correct-long-passphrase');
  expect(first).not.toBe(second);
  expect(await verifyPassword('correct-long-passphrase', first)).toBe(true);
  expect(await verifyPassword('incorrect', first)).toBe(false);
  expect(await verifyPassword('anything', 'malformed')).toBe(false);
});
it('stores a one-way hash distinct from session bearer token', () => {
  const first = createOpaqueToken();
  expect(first.token).not.toBe(first.hash);
  expect(hashToken(first.token)).toBe(first.hash);
  expect(createOpaqueToken().hash).not.toBe(first.hash);
});
