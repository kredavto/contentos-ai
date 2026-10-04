import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt:v1:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, version, salt, stored, extra] = encoded.split(':');
  if (algorithm !== 'scrypt' || version !== 'v1' || !salt || !stored || extra || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(stored)) return false;
  const key = await derive(password, salt);
  return timingSafeEqual(key, Buffer.from(stored, 'hex'));
}
export function createOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}
export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
